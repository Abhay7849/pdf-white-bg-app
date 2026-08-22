import os
import uuid
import json
import shutil
import asyncio
from typing import Dict
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pdf_processor import process_pdf

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")
DB_FILE = os.path.join(BASE_DIR, "tasks_db.json")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

app = FastAPI(title="PDF Background Converter Pro")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

def load_db() -> dict:
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {}

def save_db(db: dict):
    try:
        with open(DB_FILE, "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2)
    except:
        pass

tasks_progress = load_db()

@app.get("/", response_class=HTMLResponse)
async def read_index():
    with open(os.path.join(BASE_DIR, "templates", "index.html"), "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

def run_conversion_task(task_id: str, input_path: str, output_path: str, white_bg: bool, remove_pen: bool, high_contrast: bool):
    def progress_cb(percent, total_pages, msg):
        status = "completed" if percent >= 100 else "processing"
        tasks_progress[task_id] = {
            "percent": percent,
            "total_pages": total_pages,
            "message": msg,
            "status": status,
            "filename": tasks_progress.get(task_id, {}).get("filename", "converted.pdf"),
            "out_path": output_path
        }
        save_db(tasks_progress)
        
    try:
        process_pdf(
            input_path, 
            output_path, 
            white_bg=white_bg, 
            remove_pen=remove_pen, 
            high_contrast=high_contrast, 
            progress_callback=progress_cb
        )
    except Exception as e:
        tasks_progress[task_id] = {
            "percent": 0,
            "total_pages": 0,
            "message": f"Error during processing: {str(e)}",
            "status": "failed",
            "filename": tasks_progress.get(task_id, {}).get("filename", "converted.pdf"),
            "out_path": ""
        }
        save_db(tasks_progress)
    finally:
        if os.path.exists(input_path):
            try:
                os.remove(input_path)
            except:
                pass

@app.post("/api/upload_chunk")
async def upload_chunk(
    chunk: UploadFile = File(...),
    task_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    filename: str = Form(...),
    white_bg: bool = Form(True),
    remove_pen: bool = Form(False),
    high_contrast: bool = Form(True)
):
    clean_filename = f"white_bg_{os.path.splitext(filename)[0]}.pdf"
    input_path = os.path.join(UPLOAD_DIR, f"{task_id}.pdf")
    output_path = os.path.join(OUTPUT_DIR, f"{task_id}_{clean_filename}")

    with open(input_path, "ab") as buffer:
        content = await chunk.read()
        buffer.write(content)
        
    tasks_progress[task_id] = {
        "percent": 0,
        "total_pages": 0,
        "message": f"Uploading chunk {chunk_index+1}/{total_chunks}...",
        "status": "uploading",
        "filename": clean_filename,
        "out_path": output_path
    }
    save_db(tasks_progress)

    if chunk_index == total_chunks - 1:
        tasks_progress[task_id]["message"] = "Upload complete. Starting background conversion..."
        save_db(tasks_progress)
        
        loop = asyncio.get_event_loop()
        loop.run_in_executor(
            None, 
            run_conversion_task, 
            task_id, 
            input_path, 
            output_path, 
            white_bg, 
            remove_pen, 
            high_contrast
        )

    return {"task_id": task_id, "status": "chunk_received", "chunk_index": chunk_index}

@app.get("/api/progress/{task_id}")
async def get_progress(task_id: str):
    db = load_db()
    if task_id in db:
        return db[task_id]
    if task_id not in tasks_progress:
        raise HTTPException(status_code=404, detail="Task ID not found")
    return tasks_progress[task_id]

@app.get("/api/download/{task_id}")
async def download_file(task_id: str):
    db = load_db()
    info = db.get(task_id) or tasks_progress.get(task_id)
    
    if not info:
        raise HTTPException(status_code=404, detail="Task ID not found")
        
    out_path = info.get("out_path")
    filename = info.get("filename", "converted.pdf")
    
    if not out_path or not os.path.exists(out_path):
        raise HTTPException(status_code=404, detail="Processed file not ready or expired")
        
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache"
    }
    
    return FileResponse(
        path=out_path, 
        filename=filename, 
        media_type="application/pdf",
        headers=headers
    )

if __name__ == "__main__":
    import uvicorn
    # Dynamic PORT binding for Cloud Hosts (Render, Railway, HuggingFace, Fly.io)
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
