import hashlib
import json
import os
import re
import sqlite3
import threading
import traceback
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from datetime import datetime

import mcp_server
import export_chat
from gen_chat_html import json_to_html
from config import load_config

PORT = 5679
# 仅监听本机回环地址：服务无鉴权且能读取全部聊天记录，绝不能暴露到局域网
BIND_HOST = '127.0.0.1'
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chat_exports")
HTML_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "export_web.html")

# 内存上限：完成的导出任务/历史只保留最近若干条，避免长期运行无限增长
MAX_EXPORT_TASKS = 50
MAX_EXPORT_HISTORY = 100

_cfg = load_config()
CONTACT_CACHE = os.path.join(_cfg["decrypted_dir"], "_monitor_cache", "contact_contact.db")

export_tasks = {}
export_history = []
export_lock = threading.Lock()

_contacts_cache = None
_contacts_lock = threading.Lock()

_active_usernames_cache = None     # set of usernames with recent activity
_active_cache_ts = 0               # timestamp of last session.db read
_ACTIVE_CACHE_TTL = 300            # re-read session.db at most every 5 min


def _get_active_usernames(days=30):
    """从 session.db 查询近 N 天有消息的 username 集合。
    session.db 很小（~0.2MB），查询瞬间完成。
    """
    global _active_usernames_cache, _active_cache_ts
    import time as _time
    now = _time.time()
    if _active_usernames_cache is not None and (now - _active_cache_ts) < _ACTIVE_CACHE_TTL:
        return _active_usernames_cache

    cutoff = int(now - days * 86400)
    usernames = set()

    try:
        path = mcp_server._cache.get(os.path.join("session", "session.db"))
        if not path:
            return None
        conn = sqlite3.connect(path)
        for r in conn.execute(
            "SELECT username FROM SessionTable WHERE last_timestamp > ?", (cutoff,)
        ):
            usernames.add(r[0])
        conn.close()
    except Exception:
        return None

    _active_usernames_cache = usernames
    _active_cache_ts = now
    return usernames


def _get_all_contacts():
    global _contacts_cache
    with _contacts_lock:
        if _contacts_cache is not None:
            return _contacts_cache

    if not os.path.exists(CONTACT_CACHE):
        return []

    conn = sqlite3.connect(CONTACT_CACHE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT username, nick_name, remark FROM contact")
    rows = cur.fetchall()
    conn.close()

    contacts = []
    for r in rows:
        nick = r['nick_name'] or ''
        remark = r['remark'] or ''
        name = remark or nick or r['username']
        contacts.append({
            'name': name,
            'username': r['username'],
            'is_group': '@chatroom' in r['username'],
            'remark': remark,
            'nick_name': nick,
        })

    # 有名称的排前面，没名称的(fallback到username)排最后
    contacts.sort(key=lambda c: (
        1 if c['name'] == c['username'] else 0,  # 无名称的排后面
        c['name'].lower(),
    ))

    with _contacts_lock:
        _contacts_cache = contacts

    return contacts


def _trim_export_memory():
    """裁剪已完成的导出任务和历史，防止内存无限增长"""
    with export_lock:
        done_ids = [tid for tid, t in export_tasks.items() if t.get('done')]
        for tid in done_ids[:-MAX_EXPORT_TASKS]:
            export_tasks.pop(tid, None)
        del export_history[:-MAX_EXPORT_HISTORY]


def _do_export(task_id, names, fmt, tail=None):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with export_lock:
        export_tasks[task_id]['results'] = []
        export_tasks[task_id]['total'] = len(names)
        export_tasks[task_id]['completed'] = 0

    for i, name in enumerate(names):
        result = {'name': name, 'status': 'exporting', 'message_count': 0, 'files': [], 'error': None}

        with export_lock:
            export_tasks[task_id]['results'].append(result)
            idx = len(export_tasks[task_id]['results']) - 1

        try:
            safe_name = name.replace('/', '_').replace('\\', '_').replace(':', '_')
            json_path = os.path.join(OUTPUT_DIR, f"{safe_name}_chat_export.json")
            html_path = os.path.join(OUTPUT_DIR, f"{safe_name}_聊天记录.html")

            export_chat.export_chat(name, json_path, tail_limit=tail)

            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            msg_count = len(data.get('messages', []))

            result['message_count'] = msg_count
            result['files'].append(os.path.basename(json_path))

            if fmt in ('html', 'both'):
                json_to_html(json_path, html_path)
                result['files'].append(os.path.basename(html_path))

            if fmt == 'json' and os.path.exists(html_path):
                os.remove(html_path)

            result['status'] = 'done'

        except ValueError as e:
            result['status'] = 'error'
            result['error'] = str(e) or f'找不到联系人: {name}'
        except Exception as e:
            result['status'] = 'error'
            result['error'] = str(e) or traceback.format_exc()
        finally:
            with export_lock:
                export_tasks[task_id]['results'][idx] = result
                export_tasks[task_id]['completed'] = i + 1

    with export_lock:
        export_tasks[task_id]['done'] = True
        export_history.append({
            'task_id': task_id,
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'results': [r.copy() for r in export_tasks[task_id]['results']],
            'format': fmt,
        })
    _trim_export_memory()


class ExportHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, filepath, filename):
        with open(filepath, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Disposition', f'attachment; filename="{urllib.parse.quote(filename)}"')
        self.send_header('Content-Length', len(data))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/' or path == '/index.html':
            with open(HTML_PATH, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', len(data))
            self.end_headers()
            self.wfile.write(data)

        elif path == '/api/contacts':
            contacts = _get_all_contacts()
            params = urllib.parse.parse_qs(parsed.query)
            q = params.get('q', [''])[0].lower()
            filter_type = params.get('type', ['all'])[0]
            recent_days = params.get('recent', ['30'])[0]
            # names: 换行分隔的精确名单（前端"已收藏"视图用，
            # 避免为了几个收藏项把全量联系人发给浏览器）
            names_filter = set(
                n for n in params.get('names', [''])[0].split('\n') if n.strip()
            )

            filtered = contacts

            if names_filter:
                filtered = [c for c in filtered if c['name'] in names_filter]
            else:
                # 近期活跃过滤（默认开启，recent=0 或 recent=all 表示不过滤）
                try:
                    days = int(recent_days)
                except ValueError:
                    days = 30
                if days > 0:
                    active = _get_active_usernames(days)
                    if active is not None:
                        filtered = [c for c in filtered if c['username'] in active]

            if filter_type == 'user':
                filtered = [c for c in filtered if not c['is_group']]
            elif filter_type == 'group':
                filtered = [c for c in filtered if c['is_group']]
            if q:
                filtered = [c for c in filtered if q in c['name'].lower() or q in c['remark'].lower() or q in c['username'].lower()]

            self._send_json({'contacts': filtered, 'total': len(contacts), 'filtered': len(filtered)})

        elif path == '/api/stats':
            contacts = _get_all_contacts()
            groups = sum(1 for c in contacts if c['is_group'])
            self._send_json({'total': len(contacts), 'groups': groups, 'users': len(contacts) - groups})

        elif path.startswith('/api/export_status/'):
            task_id = path.split('/')[-1]
            with export_lock:
                task = export_tasks.get(task_id, {})
            self._send_json({
                'done': task.get('done', False),
                'results': task.get('results', []),
                'total': task.get('total', 0),
                'completed': task.get('completed', 0),
            })

        elif path.startswith('/api/download/'):
            filename = urllib.parse.unquote(path.split('/api/download/')[-1])
            # 防路径穿越：文件名必须是纯文件名（无分隔符、无 ..），且解析后仍在输出目录内
            if (not filename or filename in ('.', '..')
                    or '/' in filename or '\\' in filename or ':' in filename):
                self._send_json({'error': '非法文件名'}, 400)
                return
            filepath = os.path.realpath(os.path.join(OUTPUT_DIR, filename))
            out_root = os.path.realpath(OUTPUT_DIR) + os.sep
            if not filepath.startswith(out_root) or not os.path.isfile(filepath):
                self._send_json({'error': '文件不存在'}, 404)
                return
            self._send_file(filepath, filename)

        elif path == '/api/wx_file':
            # 保存聊天中的文件原件：按 (chat, local_id, ts) 定位微信本地缓存副本。
            # 客户端不传原始路径——由 decode_file_message 在服务端解析并校验
            # (md5/size 绑定)，杜绝任意路径读取。
            qs = urllib.parse.parse_qs(parsed.query)
            chat = (qs.get('chat', [''])[0] or '').strip()
            local_id = (qs.get('local_id', [''])[0] or '').strip()
            ts = (qs.get('ts', [''])[0] or '0').strip()
            if not (chat and local_id.isdigit()):
                self._send_json({'error': '缺少参数 chat / local_id'}, 400)
                return
            result = mcp_server.decode_file_message(chat, int(local_id), int(ts or 0))
            m = re.search(r'路径:\s*(.+)', result or '')
            filepath = m.group(1).strip() if m else ''
            if not filepath or not os.path.isfile(filepath):
                reason = (result or '定位失败').splitlines()[0]
                self._send_json({'error': f'文件不可用：{reason}'}, 404)
                return
            self._send_file(filepath, os.path.basename(filepath))

        elif path == '/api/history':
            with export_lock:
                self._send_json({'history': export_history[-20:]})

        elif path == '/api/files':
            if not os.path.exists(OUTPUT_DIR):
                self._send_json({'files': []})
                return
            files = []
            for f in os.listdir(OUTPUT_DIR):
                fp = os.path.join(OUTPUT_DIR, f)
                if os.path.isfile(fp):
                    files.append({
                        'name': f,
                        'size': os.path.getsize(fp),
                        'modified': datetime.fromtimestamp(os.path.getmtime(fp)).strftime('%Y-%m-%d %H:%M:%S'),
                    })
            files.sort(key=lambda x: x['modified'], reverse=True)
            self._send_json({'files': files})

        else:
            self._send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/export':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except json.JSONDecodeError:
                self._send_json({'error': 'Invalid JSON'}, 400)
                return

            names = data.get('names', [])
            fmt = data.get('format', 'html')
            # tail: 仅导出最近 N 条（前端预览用）；非法值按全量处理
            tail = data.get('tail')
            try:
                tail = int(tail) if tail else None
                if tail is not None and tail <= 0:
                    tail = None
            except (TypeError, ValueError):
                tail = None

            if not names:
                self._send_json({'error': '请选择至少一个联系人'}, 400)
                return

            task_id = hashlib.md5(f"{datetime.now().isoformat()}".encode()).hexdigest()[:8]
            with export_lock:
                export_tasks[task_id] = {'done': False, 'results': [], 'total': len(names), 'completed': 0}

            t = threading.Thread(target=_do_export, args=(task_id, names, fmt, tail), daemon=True)
            t.start()

            self._send_json({'task_id': task_id, 'names': names})

        else:
            self._send_json({'error': 'Not found'}, 404)


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    server = ThreadedHTTPServer((BIND_HOST, PORT), ExportHandler)
    print(f"微信聊天记录导出工具 — http://localhost:{PORT}")
    print(f"输出目录: {OUTPUT_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == '__main__':
    main()
