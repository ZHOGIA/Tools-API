import yt_dlp
import os
import re
import uuid
import threading
from pathlib import Path

# In-memory store for task progress. In a real app we'd use Redis or a DB.
TASKS = {}
DOWNLOAD_DIR = "downloads"

os.makedirs(DOWNLOAD_DIR, exist_ok=True)

def clean_filename(title):
    cleaned = re.sub(r'[^\w\s-]', '', title)
    return cleaned.strip()

def get_info(url):
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {
            'youtube': {'client': ['android', 'ios']}
        }
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        
        audio_formats = []
        for f in info.get('formats', []):
            if f.get('acodec') != 'none' and f.get('vcodec') == 'none':
                if f.get('abr'):
                    audio_formats.append({
                        'format_id': f['format_id'],
                        'ext': f['ext'],
                        'abr': round(f['abr']),
                        'filesize': f.get('filesize', 0)
                    })
        
        video_formats = []
        for f in info.get('formats', []):
            if f.get('vcodec') != 'none' and f.get('ext') == 'mp4': 
                if f.get('height'):
                    video_formats.append({
                        'format_id': f['format_id'],
                        'ext': f['ext'],
                        'resolution': f.get('height'),
                        'vcodec': f.get('vcodec'),
                        'filesize': f.get('filesize', 0)
                    })

        # Sort and deduplicate
        audio_formats = sorted(audio_formats, key=lambda x: x['abr'], reverse=True)
        # only keep unique bitrates
        unique_audio = {}
        for a in audio_formats:
            abr = a['abr']
            if abr not in unique_audio or a['filesize'] > unique_audio[abr]['filesize']:
                unique_audio[abr] = a
        audio_formats = sorted(list(unique_audio.values()), key=lambda x: x['abr'], reverse=True)

        unique_videos = {}
        for v in video_formats:
            res = v['resolution']
            if res not in unique_videos or v['filesize'] > unique_videos[res]['filesize']:
                unique_videos[res] = v
        
        video_formats = sorted(list(unique_videos.values()), key=lambda x: x['resolution'], reverse=True)

        return {
            'title': info.get('title', 'Unknown'),
            'thumbnail': info.get('thumbnail', ''),
            'duration': info.get('duration', 0),
            'formats': {
                'audio': audio_formats,
                'video': video_formats
            }
        }

class MyLogger(object):
    def debug(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): print(msg)

def progress_hook(d, task_id):
    if d['status'] == 'downloading':
        try:
            percent_str = d.get('_percent_str', '0.0%').strip()
            ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
            percent_str = ansi_escape.sub('', percent_str)

            percent = float(percent_str.replace('%', ''))
            TASKS[task_id]['progress'] = percent
            TASKS[task_id]['status'] = 'downloading'
            TASKS[task_id]['eta'] = d.get('eta', 0)
            TASKS[task_id]['speed'] = d.get('_speed_str', 'N/A')
        except Exception:
            pass
    elif d['status'] == 'finished':
        TASKS[task_id]['progress'] = 100
        TASKS[task_id]['status'] = 'processing'

def download_task(url, format_type, quality, task_id):
    TASKS[task_id] = {'status': 'starting', 'progress': 0, 'file_path': None, 'error': None}
    
    try:
        with yt_dlp.YoutubeDL({'quiet': True}) as ydl:
            info = ydl.extract_info(url, download=False)
            clean_title = clean_filename(info['title'])
            
        temp_filename = f"{clean_title}_{task_id}"
        temp_path = os.path.join(DOWNLOAD_DIR, temp_filename + ".%(ext)s")
        
        ffmpeg_loc = os.path.join(os.getcwd(), 'ffmpeg.exe')
        
        ydl_opts = {
            'outtmpl': temp_path,
            'ffmpeg_location': ffmpeg_loc if os.path.exists(ffmpeg_loc) else os.getcwd(),
            'logger': MyLogger(),
            'progress_hooks': [lambda d: progress_hook(d, task_id)],
            'extractor_args': {
                'youtube': {'client': ['android', 'ios']}
            }
        }

        if format_type == 'mp3':
            ydl_opts['format'] = 'bestaudio/best'
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': str(quality) if quality else '320',
            }]
            final_ext = 'mp3'
        elif format_type == 'mp4':
            if str(quality).isdigit():
                ydl_opts['format'] = f'bestvideo[height<={quality}]+bestaudio/best'
            else:
                ydl_opts['format'] = f'{quality}+bestaudio/best'
            
            ydl_opts['merge_output_format'] = 'mp4'
            final_ext = 'mp4'
            
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            
        out_path = None
        for file in os.listdir(DOWNLOAD_DIR):
            if temp_filename in file and file.endswith(final_ext):
                out_path = os.path.join(DOWNLOAD_DIR, file)
                break
                
        if out_path:
            TASKS[task_id]['status'] = 'done'
            TASKS[task_id]['file_path'] = out_path
            TASKS[task_id]['filename'] = f"{clean_title}.{final_ext}"
        else:
            TASKS[task_id]['status'] = 'error'
            TASKS[task_id]['error'] = "File not found after processing."
            
    except Exception as e:
        TASKS[task_id]['status'] = 'error'
        TASKS[task_id]['error'] = str(e)


def start_download(url, format_type, quality=None):
    task_id = str(uuid.uuid4())
    TASKS[task_id] = {'status': 'pending', 'progress': 0}
    t = threading.Thread(target=download_task, args=(url, format_type, quality, task_id))
    t.start()
    return task_id

def get_task_status(task_id):
    return TASKS.get(task_id, None)
