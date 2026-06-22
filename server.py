from flask import Flask, request, jsonify, redirect, send_from_directory, send_file
from flask_cors import CORS
import yt_dlp
import re
import os
import time
import uuid
import atexit
import threading

app = Flask(__name__)
CORS(app)

PORT = int(os.environ.get('PORT', 5000))
BASE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(BASE, 'frontend')
TEMP = os.path.join(BASE, 'temp')

info_cache = {}
CACHE_TTL = 300
temp_files = []
temp_lock = threading.Lock()

os.makedirs(TEMP, exist_ok=True)

app.config['MAX_CONTENT_LENGTH'] = 512 * 1024 * 1024

def cleanup():
    for f in temp_files:
        try:
            if os.path.exists(f):
                os.remove(f)
        except:
            pass

atexit.register(cleanup)

def find_ffmpeg():
    local_path = os.path.join(BASE, 'ffmpeg.exe')
    if os.path.exists(local_path):
        return local_path
    import shutil
    return shutil.which('ffmpeg')

@app.route('/')
def index():
    return send_from_directory(FRONTEND, 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(FRONTEND, path)

def get_cached_info(url):
    now = time.time()
    if url in info_cache:
        data, expiry = info_cache[url]
        if now < expiry:
            return data
        del info_cache[url]
    return None

def set_cached_info(url, data):
    info_cache[url] = (data, time.time() + CACHE_TTL)

@app.route('/api/video-info', methods=['GET'])
def video_info():
    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'URL is required'}), 400
    video_id = extract_id(url)
    if not video_id:
        return jsonify({'error': 'Invalid YouTube URL'}), 400

    cached = get_cached_info(url)
    if cached:
        return jsonify(cached)

    ydl_opts = {'quiet': True, 'no_warnings': True, 'noplaylist': True,
        'extractor_args': {'youtube': {'player_client': ['android']}},
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        all_formats = info.get('formats', [])
        video_qualities = []
        audio_qualities = []
        seen_heights = set()

        for f in all_formats:
            vcodec = f.get('vcodec', 'none')
            acodec = f.get('acodec', 'none')
            h = f.get('height')

            if vcodec == 'none' and acodec != 'none':
                abr = int(f.get('abr', 0) or 0)
                label = "Audio"
                if abr:
                    label += f" {abr}kbps"
                elif f.get('ext'):
                    label += f" ({f.get('ext')})"
                audio_qualities.append({
                    'format_id': f.get('format_id', ''),
                    'ext': f.get('ext', ''),
                    'abr': abr,
                    'filesize': f.get('filesize') or f.get('filesize_approx', 0),
                    'label': label,
                })
                continue

            if vcodec != 'none' and h:
                if h in seen_heights:
                    existing = next((x for x in video_qualities if x['height'] == h), None)
                    if existing and not existing['has_audio'] and acodec != 'none':
                        existing['has_audio'] = True
                        existing['format_id'] = f.get('format_id', existing['format_id'])
                        existing['ext'] = f.get('ext', existing['ext'])
                        existing['filesize'] = f.get('filesize') or f.get('filesize_approx', existing['filesize'])
                        existing['fps'] = f.get('fps', existing['fps'])
                    continue
                seen_heights.add(h)
                has_audio = acodec != 'none'
                label = f"{h}p"
                if h >= 2160:
                    label += " 4K"
                elif h >= 1440:
                    label += " QHD"
                elif h >= 1080:
                    label += " Full HD"
                elif h >= 720:
                    label += " HD"
                video_qualities.append({
                    'height': h,
                    'label': label,
                    'ext': f.get('ext', 'mp4'),
                    'filesize': f.get('filesize') or f.get('filesize_approx', 0),
                    'format_id': f.get('format_id', ''),
                    'has_audio': has_audio,
                    'fps': f.get('fps', 30),
                })

        video_qualities.sort(key=lambda x: x['height'], reverse=True)
        audio_qualities.sort(key=lambda x: x['abr'], reverse=True)

        result = {
            'title': info.get('title', 'Unknown'),
            'thumbnail': info.get('thumbnail', f'https://img.youtube.com/vi/{video_id}/maxresdefault.jpg'),
            'channel': info.get('channel', info.get('uploader', 'Unknown')),
            'views': info.get('view_count', 0),
            'likes': info.get('like_count', 0),
            'duration': info.get('duration', 0),
            'upload_date': info.get('upload_date', ''),
            'video_qualities': video_qualities,
            'audio_qualities': audio_qualities,
        }

        set_cached_info(url, result)
        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/download', methods=['GET'])
def download():
    url = request.args.get('url')
    format_id = request.args.get('format_id', '')
    dtype = request.args.get('type', 'video')
    has_audio_param = request.args.get('has_audio', '')

    if not url:
        return jsonify({'error': 'URL is required'}), 400

    if dtype == 'audio':
        return redirect_to_format(url, format_id)

    if dtype == 'video' and format_id:
        has_audio = True
        if has_audio_param == 'false':
            has_audio = False
        elif url in info_cache:
            data, expiry = info_cache.get(url, (None, 0))
            if data and time.time() < expiry:
                for q in data.get('video_qualities', []):
                    if q['format_id'] == format_id:
                        has_audio = q.get('has_audio', True)
                        break

        if has_audio:
            return redirect_to_format(url, format_id)
        else:
            return download_and_merge(url, format_id)

    return redirect_to_format(url, format_id)


def redirect_to_format(url, format_id):
    if format_id:
        format_spec = format_id
    else:
        format_spec = 'best[ext=mp4]/best'

    ydl_opts = {'quiet': True, 'no_warnings': True, 'format': format_spec, 'noplaylist': True,
        'extractor_args': {'youtube': {'player_client': ['android']}},
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            direct_url = info.get('url')
            if not direct_url:
                for f in info.get('formats', []):
                    if f.get('format_id') == format_id:
                        direct_url = f.get('url')
                        break
            if direct_url:
                return redirect(direct_url)
    except Exception as e:
        pass

    return jsonify({'error': 'No direct URL found'}), 500


def download_and_merge(url, format_id):
    uid = str(uuid.uuid4())[:8]
    out_path = os.path.join(TEMP, f'dl_{uid}.mp4')

    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        return jsonify({'error': 'ffmpeg not found on server'}), 500

    format_spec = f'{format_id}+bestaudio[ext=m4a]/bestaudio'

    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'format': format_spec,
        'merge_output_format': 'mp4',
        'outtmpl': out_path,
        'noplaylist': True,
        'ffmpeg_location': ffmpeg_path,
        'extractor_args': {'youtube': {'player_client': ['android']}},
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        if not os.path.exists(out_path):
            mp4_path = out_path
            if os.path.exists(mp4_path):
                out_path = mp4_path

        if not os.path.exists(out_path):
            return jsonify({'error': 'Download failed - no output file'}), 500

        with temp_lock:
            temp_files.append(out_path)

        return send_file(
            out_path,
            as_attachment=True,
            download_name=f'video_{uid}.mp4',
            mimetype='video/mp4',
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def extract_id(url):
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$'
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


if __name__ == '__main__':
    print(f"Server: http://localhost:{PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=True)
