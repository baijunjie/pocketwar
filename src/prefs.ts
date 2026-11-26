/**
 * 玩家偏好的本地存储：键统一加 `fengyan.` 前缀（与 `audio/sound.ts`、`ui/menu.ts` 的键一致），
 * 读写都包 try/catch：隐私模式或存储被禁用时读到缺省值、写入作罢，只在本局生效。
 */
const PREFIX = 'fengyan.';

export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* 存不了就只在本局生效 */
  }
}
