import { describe, expect, it } from 'vitest';
import { ATTACK_VARIANTS, CLIP_FALLBACK, ONE_SHOT, STD_ACTIONS, TWIST_CLIPS, mountAction, type StdAction } from '../../../src/render/models/actions';
import { clipOf, type Clip } from '../../../src/render/rig';

describe('STD_ACTIONS', () => {
  it('包含规范里的全部标准动作，没有重复', () => {
    expect([...STD_ACTIONS].sort()).toEqual([
      'attack', 'attack2', 'attack3', 'attack4', 'attackMove', 'attackMoveBL', 'attackMoveBR', 'attackMoveL', 'attackMoveR',
      'brace', 'charge', 'die', 'guard', 'guardWalk', 'idle', 'ready', 'run', 'walk',
    ]);
  });
});

describe('ATTACK_VARIANTS', () => {
  it('站着出手的几种攻击：attack 打头，再加 attack2、attack3、attack4，都是标准动作', () => {
    expect(ATTACK_VARIANTS).toEqual(['attack', 'attack2', 'attack3', 'attack4']);
    for (const a of ATTACK_VARIANTS) expect(STD_ACTIONS as readonly string[]).toContain(a);
  });
});

describe('ONE_SHOT', () => {
  it('只有播一遍就停的动作：各种出手、回身射击、阵亡', () => {
    expect([...ONE_SHOT].sort()).toEqual([
      'attack', 'attack2', 'attack3', 'attack4', 'attackMoveBL', 'attackMoveBR', 'attackMoveL', 'attackMoveR', 'die',
    ]);
  });

  it('出手的每种变体都是播一遍就停的', () => {
    for (const a of ATTACK_VARIANTS) expect(ONE_SHOT.has(a), a).toBe(true);
  });

  it('循环动作（待命、移动、边跑边打等）不在其中', () => {
    for (const a of ['idle', 'ready', 'walk', 'run', 'attackMove', 'charge', 'brace', 'guard', 'guardWalk']) expect(ONE_SHOT.has(a), a).toBe(false);
  });
});

describe('TWIST_CLIPS', () => {
  const deg = (name: string): number => (TWIST_CLIPS.find(t => t[0] === name)![1] * 180) / Math.PI;

  it('四个回身射击动作，名字都是标准动作', () => {
    expect(TWIST_CLIPS.map(t => t[0]).sort()).toEqual(['attackMoveBL', 'attackMoveBR', 'attackMoveL', 'attackMoveR']);
    for (const [name] of TWIST_CLIPS) expect(STD_ACTIONS as readonly string[]).toContain(name);
  });

  it('朝左 90°、朝右 90°、左后约 140°、右后约 140°（左为正）', () => {
    expect(deg('attackMoveL')).toBeCloseTo(90, 6);
    expect(deg('attackMoveR')).toBeCloseTo(-90, 6);
    expect(deg('attackMoveBL')).toBeCloseTo(140, 0);
    expect(deg('attackMoveBR')).toBeCloseTo(-140, 0);
  });
});

describe('CLIP_FALLBACK', () => {
  it('键与退路都是标准动作，不退回自己', () => {
    const std = STD_ACTIONS as readonly string[];
    for (const [k, list] of Object.entries(CLIP_FALLBACK)) {
      expect(std, k).toContain(k);
      expect(list, k).not.toContain(k);
      for (const a of list) expect(std, `${k} → ${a}`).toContain(a);
    }
  });

  it('规范里写明的缺省退路', () => {
    expect(CLIP_FALLBACK.ready[0]).toBe('idle');
    expect(CLIP_FALLBACK.attackMove[0]).toBe('attack');
    for (const a of ['attackMoveL', 'attackMoveR', 'attackMoveBL', 'attackMoveBR']) expect(CLIP_FALLBACK[a][0], a).toBe('attackMove');
    expect(CLIP_FALLBACK.charge[0]).toBe('run');
    expect(CLIP_FALLBACK.guardWalk[0]).toBe('walk');
  });

  it('attack2、attack3、attack4 缺了先退 attack，再退 idle', () => {
    for (const a of ['attack2', 'attack3', 'attack4']) expect(CLIP_FALLBACK[a], a).toEqual(['attack', 'idle']);
  });

  it('只有 attack 的素材，变体都取到 attack；有自己的变体就用自己的', () => {
    const c = (start: number): Clip => ({ start, n: 1, seconds: 1 });
    const only = { idle: c(0), attack: c(10) };
    for (const a of ATTACK_VARIANTS) expect(clipOf({ clips: only }, a, CLIP_FALLBACK), a).toBe(only.attack);
    const more = { ...only, attack2: c(20) };
    expect(clipOf({ clips: more }, 'attack2', CLIP_FALLBACK)).toBe(more.attack2);
    expect(clipOf({ clips: more }, 'attack3', CLIP_FALLBACK)).toBe(more.attack);
  });

  it('brace、guard 先退 ready，再退 idle', () => {
    expect(CLIP_FALLBACK.brace).toEqual(['ready', 'idle']);
    expect(CLIP_FALLBACK.guard).toEqual(['ready', 'idle']);
  });

  it('只有 idle 的素材，每个标准动作都能退到 idle', () => {
    const only = { idle: { start: 0, n: 1, seconds: 1 } };
    for (const a of STD_ACTIONS) expect(clipOf({ clips: only }, a, CLIP_FALLBACK), a).toBe(only.idle);
  });

  it('按退路取动作：先同名，再依次退，最后 idle', () => {
    const c = (start: number): Clip => ({ start, n: 1, seconds: 1 });
    const clips = { idle: c(0), attack: c(10), ready: c(20) };
    expect(clipOf({ clips }, 'attack', CLIP_FALLBACK)).toBe(clips.attack);
    expect(clipOf({ clips }, 'attackMoveL', CLIP_FALLBACK)).toBe(clips.attack);
    expect(clipOf({ clips }, 'brace', CLIP_FALLBACK)).toBe(clips.ready);
    expect(clipOf({ clips }, 'walk', CLIP_FALLBACK)).toBe(clips.idle);
  });
});

describe('mountAction：骑兵每个标准动作配坐骑的哪个动作', () => {
  const table: [StdAction, string][] = [
    ['walk', 'walk'], ['guardWalk', 'walk'],
    ['run', 'run'], ['charge', 'run'],
    ['attackMove', 'run'], ['attackMoveL', 'run'], ['attackMoveR', 'run'], ['attackMoveBL', 'run'], ['attackMoveBR', 'run'],
    ['die', 'die'],
    ['idle', 'idle'], ['ready', 'idle'], ['attack', 'idle'], ['attack2', 'idle'], ['attack3', 'idle'], ['attack4', 'idle'], ['brace', 'idle'], ['guard', 'idle'],
  ];

  it.each(table)('%s → %s', (std, want) => {
    expect(mountAction(std)).toBe(want);
  });

  it('覆盖全部标准动作', () => {
    expect(table.map(t => t[0]).sort()).toEqual([...STD_ACTIONS].sort());
  });
});
