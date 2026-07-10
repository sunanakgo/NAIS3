/**
 * 생성 큐 완료 알림 — 알림음(WebAudio 합성, 에셋 불필요) + 네이티브 알림(메인 프로세스).
 * 설정: alert_sound / alert_native (기본 OFF). 트리거는 generation-store의 큐 소진 시점.
 */

/** 두 음(A5→E6) 차임 — 짧고 부드러운 "띠링" */
export function playChime(): void {
  const ctx = new AudioContext()
  const tone = (freq: number, start: number, dur: number, peak: number): void => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t0 = ctx.currentTime + start
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur)
  }
  tone(880, 0, 0.35, 0.12) // A5
  tone(1318.5, 0.09, 0.5, 0.1) // E6
  setTimeout(() => void ctx.close(), 900)
}

/** 큐가 다 비었을 때 한 번 호출 — 설정에 따라 소리/네이티브 알림 */
export async function queueDoneAlert(done: number, failed: number): Promise<void> {
  const [sound, native] = await Promise.all([
    window.nais.invoke('settings:get', { key: 'alert_sound' }),
    window.nais.invoke('settings:get', { key: 'alert_native' })
  ])
  if (sound.value === '1') playChime()
  // 포커스 판정은 메인이 담당 (창을 보고 있으면 토스트 생략)
  if (native.value === '1') void window.nais.invoke('notify:done', { done, failed })
}
