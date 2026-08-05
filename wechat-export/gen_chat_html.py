import json
import os
import sys
from datetime import datetime


def esc(text):
    if not text:
        return ''
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('\n', '<br>')


def json_to_html(json_path, output_path):
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    messages = data['messages']
    chat_name = data['chat']
    total = len(messages)

    date_groups = {}
    for msg in messages:
        ts = msg.get('timestamp', 0)
        dt = datetime.fromtimestamp(ts) if ts else datetime.now()
        date_key = dt.strftime('%Y-%m-%d')
        if date_key not in date_groups:
            date_groups[date_key] = []
        date_groups[date_key].append((dt, msg))

    dates = sorted(date_groups.keys())
    first_date = dates[0] if dates else '?'
    last_date = dates[-1] if dates else '?'

    html_parts = []

    for date_key in dates:
        day_msgs = date_groups[date_key]
        weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
        dt_obj = datetime.strptime(date_key, '%Y-%m-%d')
        weekday = weekdays[dt_obj.weekday()]
        display_date = dt_obj.strftime('%Y年%m月%d日') + ' ' + weekday

        html_parts.append(f'      <div class="date-divider" id="d-{date_key}"><span>{display_date}</span></div>')

        for dt, msg in day_msgs:
            sender = msg.get('sender', '')
            content = msg.get('content', '')
            msg_type = msg.get('type', 'text')
            is_me = sender == 'me'
            time_str = dt.strftime('%H:%M')

            if msg_type == 'recall':
                html_parts.append(f'      <div class="system-msg">↩️ {esc(sender)} 撤回了一条消息</div>')
                continue

            if msg_type == 'system':
                html_parts.append(f'      <div class="system-msg">🔔 {esc(content)}</div>')
                continue

            avatar = '<div class="avatar me-avatar">我</div>' if is_me else f'<div class="avatar other-avatar">{esc(sender[:1])}</div>'

            if msg_type == 'text':
                bubble_content = f'<div class="bubble-text">{esc(content)}</div>'
            elif msg_type == 'image':
                bubble_content = '<div class="bubble-text">🖼️ [图片]</div>'
            elif msg_type == 'voice':
                bubble_content = '<div class="bubble-text">🎤 [语音消息]</div>'
            elif msg_type == 'video':
                bubble_content = f'<div class="bubble-text">🎬 {esc(content)}</div>' if content else '<div class="bubble-text">🎬 [视频]</div>'
            elif msg_type == 'sticker':
                bubble_content = f'<div class="bubble-text">{esc(content)}</div>' if content else '<div class="bubble-text">[表情]</div>'
            elif msg_type == 'link_or_file':
                bubble_content = f'<div class="bubble-text">📎 {esc(content)}</div>' if content else '<div class="bubble-text">📎 [链接/文件]</div>'
            elif msg_type == 'location':
                bubble_content = '<div class="bubble-text">📍 [位置]</div>'
            elif msg_type == 'contact_card':
                bubble_content = '<div class="bubble-text">👤 [名片]</div>'
            elif msg_type == 'call':
                bubble_content = '<div class="bubble-text">📞 [通话]</div>'
            else:
                bubble_content = f'<div class="bubble-text">{esc(content)}</div>'

            bubble_class = 'bubble me-bubble' if is_me else 'bubble other-bubble'
            row_class = 'msg-row msg-me' if is_me else 'msg-row msg-other'
            time_html = f'<div class="msg-time">{time_str}</div>'

            if is_me:
                html_parts.append(f'''      <div class="{row_class}">
        <div class="msg-content">{time_html}<div class="{bubble_class}">{bubble_content}</div></div>
        {avatar}
      </div>''')
            else:
                html_parts.append(f'''      <div class="{row_class}">
        {avatar}
        <div class="msg-content"><div class="{bubble_class}">{bubble_content}</div>{time_html}</div>
      </div>''')

    msgs_html = '\n'.join(html_parts)

    me_count = sum(1 for m in messages if m.get('sender') == 'me')
    other_count = total - me_count
    day_span = (datetime.strptime(last_date, "%Y-%m-%d") - datetime.strptime(first_date, "%Y-%m-%d")).days if first_date != '?' else 0

    jump_links = ''.join(f'<a href="#d-{d}">{d[5:]}</a>' for d in dates[:30])

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>聊天记录 - {esc(chat_name)}</title>
<style>
* {{margin:0;padding:0;box-sizing:border-box}}
body {{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:#ebebeb;color:#333;line-height:1.6}}
.header {{background:linear-gradient(135deg,#07c160,#06ad56);color:white;padding:30px 20px;text-align:center;position:sticky;top:0;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,0.15)}}
.header h1 {{font-size:22px;font-weight:600}}
.header .info {{font-size:13px;opacity:0.9;margin-top:6px}}
.chat-container {{max-width:700px;margin:0 auto;padding:16px}}
.date-divider {{text-align:center;margin:20px 0 16px}}
.date-divider span {{background:#d4d4d4;color:#666;font-size:12px;padding:4px 14px;border-radius:4px}}
.msg-row {{display:flex;align-items:flex-start;margin-bottom:12px;padding:0 8px}}
.msg-me {{justify-content:flex-end}}
.msg-other {{justify-content:flex-start}}
.avatar {{width:40px;height:40px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:white;flex-shrink:0}}
.me-avatar {{background:#07c160;margin-left:10px}}
.other-avatar {{background:#576b95;margin-right:10px}}
.msg-content {{max-width:65%;display:flex;flex-direction:column}}
.msg-me .msg-content {{align-items:flex-end}}
.msg-other .msg-content {{align-items:flex-start}}
.bubble {{padding:10px 14px;border-radius:8px;font-size:15px;word-break:break-word;line-height:1.5}}
.me-bubble {{background:#95ec69;color:#333;border-top-right-radius:2px}}
.other-bubble {{background:white;color:#333;border-top-left-radius:2px;box-shadow:0 1px 2px rgba(0,0,0,0.05)}}
.bubble-text {{max-width:100%}}
.msg-time {{font-size:11px;color:#999;margin-top:3px;padding:0 4px}}
.system-msg {{text-align:center;color:#999;font-size:12px;margin:12px 0;background:#e0e0e0;display:inline-block;padding:3px 12px;border-radius:4px;margin-left:50%;transform:translateX(-50%)}}
.stats-bar {{background:white;padding:12px 20px;display:flex;justify-content:center;gap:24px;font-size:13px;color:#666;border-bottom:1px solid #e0e0e0}}
.stats-bar span {{color:#07c160;font-weight:600}}
.footer {{text-align:center;padding:30px;color:#999;font-size:12px}}
.jump-bar {{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:8px}}
.jump-bar a {{color:rgba(255,255,255,0.85);text-decoration:none;font-size:12px;background:rgba(255,255,255,0.15);padding:3px 10px;border-radius:10px}}
.jump-bar a:hover {{background:rgba(255,255,255,0.3)}}
@media(max-width:600px){{.msg-content{{max-width:78%}}.header h1{{font-size:18px}}}}
</style>
</head>
<body>

<div class="header">
  <h1>💬 与 {esc(chat_name)} 的聊天记录</h1>
  <div class="info">{first_date} ~ {last_date} · 共 {total} 条消息</div>
  <div class="jump-bar">
    {jump_links}
  </div>
</div>

<div class="stats-bar">
  <div>总消息 <span>{total}</span> 条</div>
  <div>跨度 <span>{day_span}</span> 天</div>
  <div>我发送 <span>{me_count}</span> 条</div>
  <div>{esc(chat_name)} 发送 <span>{other_count}</span> 条</div>
</div>

<div class="chat-container">
{msgs_html}
</div>

<div class="footer">
  <p>导出时间：{data.get("exported_at","")}</p>
</div>

</body>
</html>'''

    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"  HTML 已生成: {output_path} ({len(html)//1024} KB)")
    return output_path


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python gen_chat_html.py <chat_export.json> [output.html]")
        sys.exit(1)

    json_path = sys.argv[1]
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        base = os.path.splitext(os.path.basename(json_path))[0]
        output_path = base + '_聊天记录.html'

    json_to_html(json_path, output_path)
