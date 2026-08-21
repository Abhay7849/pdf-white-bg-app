import pymupdf
import cv2
import numpy as np
import time
import os
from concurrent.futures import ThreadPoolExecutor

def convert_single_image(img_bgr, white_bg=True, remove_pen=False, high_contrast=True):
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    
    # 1. Pen Mark Removal (if enabled)
    if remove_pen:
        b, g, r = cv2.split(img_bgr.astype(np.int16))
        pen_mask = (b - r > 35) & (b - g > 25) & (b > 85) & (hsv[:,:,0] >= 105) & (hsv[:,:,0] <= 138)
        mask_u8 = (pen_mask * 255).astype(np.uint8)
        if np.any(mask_u8):
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            dilated_mask = cv2.dilate(mask_u8, kernel, iterations=1)
            img_bgr = cv2.inpaint(img_bgr, dilated_mask, inpaintRadius=4, flags=cv2.INPAINT_TELEA)
            hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    # 2. White Background Conversion (if enabled)
    if white_bg:
        border_pixels = np.concatenate([
            img_bgr[:25, :, :].reshape(-1, 3),
            img_bgr[-25:, :, :].reshape(-1, 3),
            img_bgr[:, :25, :].reshape(-1, 3),
            img_bgr[:, -25:, :].reshape(-1, 3)
        ], axis=0)
        
        bg_median = np.median(border_pixels, axis=0)  # [B, G, R]
        bg_v = cv2.cvtColor(np.uint8([[bg_median]]), cv2.COLOR_BGR2HSV)[0, 0, 2]
        
        if bg_v <= 200:
            inv_bgr = 255 - img_bgr
            
            diff = img_bgr.astype(np.float32) - bg_median.astype(np.float32)
            dist = np.sqrt(np.sum(diff**2, axis=2))
            
            bg_threshold = 60.0
            bg_mask = dist < bg_threshold
            
            dark_bg = (hsv[:,:,2] < 160) & (dist < 80.0)
            bg_mask = bg_mask | dark_bg
            
            inv_bgr[bg_mask] = [255, 255, 255]
            img_bgr = inv_bgr

    # Fast JPEG encoding quality 75
    _, buf = cv2.imencode('.jpg', img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 75])
    return buf.tobytes()

def process_page_task(args):
    idx, raw_bytes, white_bg, remove_pen, high_contrast = args
    if raw_bytes is None:
        return idx, None
    nparr = np.frombuffer(raw_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        return idx, None
    processed_bytes = convert_single_image(img_bgr, white_bg=white_bg, remove_pen=remove_pen, high_contrast=high_contrast)
    return idx, processed_bytes

def process_pdf(input_path, output_path, white_bg=True, remove_pen=False, high_contrast=True, progress_callback=None):
    t0 = time.time()
    doc = pymupdf.open(input_path)
    total_pages = len(doc)
    
    if progress_callback:
        progress_callback(2, total_pages, f"Opened document with {total_pages} pages")
        
    page_data = []
    page_rects = []
    
    step = max(1, total_pages // 50)
    
    for i in range(total_pages):
        page = doc[i]
        page_rects.append(page.rect)
        
        extracted = False
        try:
            imgs = page.get_images()
            if imgs:
                base_img = doc.extract_image(imgs[0][0])
                if base_img and 'image' in base_img:
                    page_data.append((i, base_img['image'], white_bg, remove_pen, high_contrast))
                    extracted = True
        except Exception:
            pass
            
        if not extracted:
            try:
                pix = page.get_pixmap(dpi=100)
                img_np = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
                img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
                _, buf = cv2.imencode('.jpg', img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 75])
                page_data.append((i, buf.tobytes(), white_bg, remove_pen, high_contrast))
            except Exception as e:
                print(f"Error on page {i}: {e}")
                
        if progress_callback and (i % step == 0 or i == total_pages - 1):
            pct = 2 + int((i / total_pages) * 28)
            progress_callback(pct, total_pages, f"Loaded page {i+1}/{total_pages}")
            
    # Parallel processing
    max_workers = min(16, (os.cpu_count() or 4) * 2)
    processed_dict = {}
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = executor.map(process_page_task, page_data)
        count = 0
        for idx, img_bytes in results:
            processed_dict[idx] = img_bytes
            count += 1
            if progress_callback and (count % step == 0 or count == total_pages):
                pct = 30 + int((count / total_pages) * 60)
                progress_callback(pct, total_pages, f"Converting page {count}/{total_pages}")
                
    if progress_callback:
        progress_callback(92, total_pages, "Assembling output PDF file...")
        
    out_doc = pymupdf.open()
    for i in range(total_pages):
        rect = page_rects[i]
        new_page = out_doc.new_page(width=rect.width, height=rect.height)
        img_bytes = processed_dict.get(i)
        if img_bytes:
            new_page.insert_image(rect, stream=img_bytes)
            
    out_doc.save(output_path)
    out_doc.close()
    doc.close()
    
    t1 = time.time()
    if progress_callback:
        progress_callback(100, total_pages, f"Complete! Finished in {t1-t0:.1f}s.")
    return True
