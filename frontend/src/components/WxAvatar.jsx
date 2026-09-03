import { Users } from 'lucide-react'

// 微信式圆角方形头像：按名字哈希取一组固定的柔和渐变，
// 同一个名字在任何列表/消息里颜色始终一致。
const PALETTES = [
  ['#8FB8F8', '#5E8DE0'],
  ['#F2A48C', '#E0785E'],
  ['#93D48A', '#5CB352'],
  ['#C0A0E8', '#9268D0'],
  ['#EFC878', '#D89A38'],
  ['#7ED0C4', '#3FA89A'],
  ['#EE9AB4', '#D96A8C'],
  ['#9FC2E8', '#6E9BD0'],
]

function hashCode(s) {
  let h = 0
  for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

export default function WxAvatar({ kind = 'user', seed = '', size = 38, text = '' }) {
  const [c1, c2] = PALETTES[hashCode(seed) % PALETTES.length]
  const bg = kind === 'me'
    ? 'linear-gradient(135deg,#8FDB5C,#5FBE33)'
    : kind === 'group'
      ? 'linear-gradient(135deg,#B9C2CE,#8C98A8)'
      : `linear-gradient(135deg,${c1},${c2})`
  return (
    <span className="wx-chat-avatar" style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.38) }}>
      {kind === 'group'
        ? <Users size={Math.round(size * 0.48)} strokeWidth={2} />
        : (text || '?').slice(0, 1)}
    </span>
  )
}
