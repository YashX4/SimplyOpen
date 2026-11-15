import { s } from '../s'

/**
 * The little picture of the app on a card. Every project gets the same
 * kit window, so the picture is drawn from the kit rather than
 * screenshotted: a drop zone or some text, one control, and Run.
 *
 * Which of the board's variants a project gets, and in which of the five
 * colours, is worked out from its slug so it never changes between visits.
 */
const TINTS = ['#2f6f6a', '#3b63a8', '#a8692c', '#6b5ca8', '#b4563c']
const ICONS = [
  'M7 3h7l4 4v14H7zM14 3v4h4',
  'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4',
  'M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3M12 4v11M8 11l4 4 4-4',
]

function hash(text: string): number {
  let n = 7
  for (const ch of text) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return n
}

const bar = (w: string, h: string, a: number) =>
  s(`display:block;flex:none;width:${w};height:${h};border-radius:calc(${h} / 2);background:rgba(9,23,23,${a})`)

export function Cover({ slug }: { slug: string }) {
  const n = hash(slug)
  const tint = TINTS[n % TINTS.length] ?? '#2f6f6a'
  const icon = ICONS[(n >>> 3) % ICONS.length] ?? ''
  const lines = (n >>> 5) % 4 === 3
  const control = (n >>> 7) % 3

  return (
    <div aria-hidden="true" style={s('position:relative;border-radius:12px;overflow:hidden;aspect-ratio:16 / 10')}>
      <div className="cv" style={{ background: 'linear-gradient(162deg,#f2f3f0 0%,#e4e7e4 100%)' }}>
        <div style={s('display:flex;flex-direction:column;gap:2.1cqw;width:74cqw;padding:2.6cqw;box-sizing:border-box;border-radius:2.8cqw;background:#fff;border:0.3cqw solid rgba(9,23,23,0.1);box-shadow:0 1.2cqw 3.4cqw rgba(9,23,23,0.1)')}>
          <div style={s('display:flex;align-items:center;gap:1.2cqw')}>
            {[0.34, 0.22, 0.15].map((a) => (
              <i key={a} style={s(`display:block;width:1.7cqw;height:1.7cqw;border-radius:50%;background:rgba(9,23,23,${a})`)} />
            ))}
            <span style={{ width: '1.2cqw' }} />
            <i style={bar('20cqw', '1.3cqw', 0.24)} />
          </div>

          {lines ? (
            <div style={s('display:flex;flex-direction:column;gap:1.3cqw;height:13cqw;padding:1.8cqw;box-sizing:border-box;border-radius:1.6cqw;border:0.3cqw solid rgba(9,23,23,0.16)')}>
              <i style={bar('48cqw', '1.2cqw', 0.24)} />
              <i style={bar('40cqw', '1.2cqw', 0.18)} />
              <i style={bar('26cqw', '1.2cqw', 0.13)} />
            </div>
          ) : (
            <div style={s('display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.4cqw;height:17cqw;border:0.4cqw dashed rgba(9,23,23,0.16);border-radius:2cqw')}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" style={s('display:block;width:5.6cqw;height:5.6cqw')}>
                <path d={icon} />
              </svg>
              <i style={bar('24cqw', '1.3cqw', 0.3)} />
              <i style={bar('15cqw', '1.1cqw', 0.16)} />
            </div>
          )}

          {control === 0 ? (
            <div style={s('display:flex;gap:1.5cqw')}>
              <i style={s(`display:block;width:13.5cqw;height:4.2cqw;border-radius:2.1cqw;background:${tint};opacity:0.9`)} />
              <i style={s('display:block;width:13.5cqw;height:4.2cqw;border-radius:2.1cqw;border:0.3cqw solid rgba(9,23,23,0.16)')} />
              <i style={s('display:block;width:13.5cqw;height:4.2cqw;border-radius:2.1cqw;border:0.3cqw solid rgba(9,23,23,0.16)')} />
            </div>
          ) : control === 1 ? (
            <div style={s('display:flex;align-items:center;height:5cqw;padding:0 1.8cqw;border-radius:1.4cqw;border:0.3cqw solid rgba(9,23,23,0.16)')}>
              <i style={bar('21cqw', '1.2cqw', 0.24)} />
            </div>
          ) : (
            <div style={s('display:flex;align-items:center;justify-content:space-between')}>
              <i style={bar('23cqw', '1.3cqw', 0.26)} />
              <i style={s(`display:flex;align-items:center;justify-content:flex-end;width:7.6cqw;height:4.2cqw;border-radius:2.1cqw;background:${tint};padding:0.45cqw;box-sizing:border-box;opacity:0.9`)}>
                <b style={s('display:block;width:3.3cqw;height:3.3cqw;border-radius:50%;background:#fff')} />
              </i>
            </div>
          )}

          <div style={s(`display:flex;align-items:center;justify-content:center;height:5.8cqw;border-radius:2.9cqw;background:${tint}`)}>
            <i style={s('display:block;width:7.6cqw;height:1.3cqw;border-radius:0.65cqw;background:rgba(255,255,255,0.95)')} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** The small version that sits at the left of a search result. */
export function Thumb({ slug }: { slug: string }) {
  const tint = TINTS[hash(slug) % TINTS.length] ?? '#2f6f6a'
  return (
    <div aria-hidden="true" style={s('position:relative;flex:none;width:150px;height:96px;border-radius:12px;overflow:hidden;background:linear-gradient(162deg,#f2f3f0 0%,#e4e7e4 100%);container-type:inline-size;display:flex;align-items:center;justify-content:center')}>
      <div style={s('display:flex;flex-direction:column;gap:3.5cqw;width:74cqw;padding:4cqw;box-sizing:border-box;border-radius:4cqw;background:#fff;border:0.5cqw solid rgba(9,23,23,0.1);box-shadow:0 2cqw 5cqw rgba(9,23,23,0.1)')}>
        <i style={s('display:block;width:46%;height:2.6cqw;border-radius:1.3cqw;background:rgba(9,23,23,0.24)')} />
        <i style={s('display:block;width:100%;height:17cqw;border-radius:3cqw;border:0.7cqw dashed rgba(9,23,23,0.16)')} />
        <i style={s(`display:block;width:100%;height:7cqw;border-radius:3.5cqw;background:${tint}`)} />
      </div>
    </div>
  )
}
