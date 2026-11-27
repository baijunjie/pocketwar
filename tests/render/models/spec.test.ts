import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnitModel } from '../../../src/render/rig';

const gltf = vi.hoisted(() => ({ rigModel: vi.fn(), mountedModel: vi.fn() }));
const loader = vi.hoisted(() => ({ loadAssets: vi.fn<(list: string[]) => Promise<void>>() }));
vi.mock('../../../src/render/models/gltf', () => gltf);
vi.mock('../../../src/render/assets', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/render/assets')>(),
  loadAssets: loader.loadAssets,
}));

const RIG = (src: string, extra: Record<string, unknown> = {}) => ({ kind: 'rig', src, anims: 'human', set: 'sword_shield', ...extra });
const MANIFEST = {
  version: 1,
  libraries: { human: 'units/anims/human.glb' },
  models: {
    legion: RIG('units/rome/legion.glb', { portrait: 3 }),
    velites: RIG('units/rome/velites.glb'),
    onager: { kind: 'rig', src: 'units/rome/onager.glb' },
    equites: {
      kind: 'mounted',
      rider: { src: 'units/rome/equites.glb', anims: 'human' },
      mount: { src: 'units/anims/horse.glb' },
    },
    zzz: { kind: 'rig', src: 'units/zzz.glb' },
  },
};

function reply(body: unknown, opts: { ok?: boolean; type?: string; badJson?: boolean } = {}) {
  return {
    ok: opts.ok ?? true,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? opts.type ?? 'application/json' : null) },
    json: async () => {
      if (opts.badJson) throw new SyntaxError('Unexpected token <');
      return body;
    },
  };
}

/** 每个用例重新载入一份 spec.ts（清单与「已退回」记录都是模块级状态） */
async function fresh() {
  vi.resetModules();
  const spec = await import('../../../src/render/models/spec');
  const { MODELS } = await import('../../../src/render/models/catalog');
  return { ...spec, MODELS };
}

const fakeModel = (height = 12): UnitModel => ({ height, clips: {}, strides: {} }) as unknown as UnitModel;
const stubManifest = (r: unknown): void => { vi.stubGlobal('fetch', vi.fn(async () => r)); };

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  gltf.rigModel.mockReset();
  gltf.mountedModel.mockReset();
  loader.loadAssets.mockReset();
  loader.loadAssets.mockResolvedValue(undefined);
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadModelManifest', () => {
  it('清单合法：返回 null，登记的模型改用清单里的素材', async () => {
    const s = await fresh();
    stubManifest(reply(MANIFEST));
    expect(await s.loadModelManifest()).toBeNull();
    expect(s.modelSpec('legion')).toMatchObject({ kind: 'rig', src: 'units/rome/legion.glb' });
    expect(errors).not.toHaveBeenCalled();
  });

  it('404（服务器没有这个文件）：返回 null，全部用代码建模', async () => {
    const s = await fresh();
    stubManifest(reply(null, { ok: false }));
    expect(await s.loadModelManifest()).toBeNull();
    expect(s.modelSpec('legion')).toBe(s.MODELS.legion);
  });

  it('内容类型不是 JSON（开发服务器对不存在的文件回 index.html）：返回 null，不当清单用', async () => {
    const s = await fresh();
    stubManifest(reply(MANIFEST, { type: 'text/html' }));
    expect(await s.loadModelManifest()).toBeNull();
    expect(s.modelSpec('legion')).toBe(s.MODELS.legion);
  });

  it('没有内容类型头：同样不用', async () => {
    const s = await fresh();
    stubManifest({ ok: true, headers: { get: () => null }, json: async () => MANIFEST });
    expect(await s.loadModelManifest()).toBeNull();
    expect(s.modelSpec('legion')).toBe(s.MODELS.legion);
  });

  it('请求本身失败（断网）：返回 null，不抛', async () => {
    const s = await fresh();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await s.loadModelManifest()).toBeNull();
  });

  it('清单格式有误：返回 Error、控制台报错，整份不用（包括其中本来合法的模型）', async () => {
    const s = await fresh();
    stubManifest(reply({ libraries: MANIFEST.libraries, models: { legion: RIG('a.glb'), bad: { kind: 'static' } } }));
    const e = await s.loadModelManifest();
    expect(e).toBeInstanceOf(Error);
    expect(e!.message).toMatch(/bad/);
    expect(errors).toHaveBeenCalled();
    expect(s.modelSpec('legion')).toBe(s.MODELS.legion);
  });

  it('内容不是合法 JSON：返回 Error，不用清单', async () => {
    const s = await fresh();
    stubManifest(reply(null, { badJson: true }));
    expect(await s.loadModelManifest()).toBeInstanceOf(Error);
    expect(s.modelSpec('legion')).toBe(s.MODELS.legion);
  });
});

describe('modelSpec / modelAssets', () => {
  it('没登记的模型 id 抛错并带 id', async () => {
    const s = await fresh();
    expect(() => s.modelSpec('nobody')).toThrow(/nobody/);
  });

  it('_e 没登记时沿用清单里初级形态的素材；登记了就用自己的', async () => {
    const s = await fresh();
    stubManifest(reply({ ...MANIFEST, models: { ...MANIFEST.models, velites_e: RIG('units/rome/velites_e.glb') } }));
    await s.loadModelManifest();
    expect(s.modelSpec('legion_e')).toMatchObject({ src: 'units/rome/legion.glb' });
    expect(s.modelSpec('velites_e')).toMatchObject({ src: 'units/rome/velites_e.glb' });
  });

  it('没有清单时 _e 用代码建模里推出来的高级形态', async () => {
    const s = await fresh();
    expect(s.modelSpec('legion_e')).toBe(s.MODELS.legion_e);
  });

  it('要预加载的素材：清单里的文件（去重）加上代码建模骑兵用的马', async () => {
    const s = await fresh();
    expect(s.modelAssets()).toContain(s.DEFAULT_MOUNT);
    stubManifest(reply(MANIFEST));
    await s.loadModelManifest();
    const list = s.modelAssets();
    expect(list).toContain('units/rome/legion.glb');
    expect(list).toContain('units/anims/human.glb');
    expect(list).toContain(s.DEFAULT_MOUNT);
    expect(list.length).toBe(new Set(list).size);
  });

  it('代码建模的骑兵指定了自己的马时，预加载那匹', async () => {
    const s = await fresh();
    s.registerModel('custom', { kind: 'horse', human: { weapon: 'lance' }, mount: 'my/horse.glb' });
    expect(s.modelAssets()).toContain('my/horse.glb');
  });
});

describe('loadUnitModels', () => {
  const failOn = (...files: string[]): void => {
    loader.loadAssets.mockImplementation(async list => {
      if (list.some(f => files.includes(f))) throw new Error(`加载失败 ${list.join()}`);
    });
  };

  it('全部加载成功：返回空，清单原样保留', async () => {
    const s = await fresh();
    stubManifest(reply(MANIFEST));
    expect(await s.loadUnitModels()).toEqual([]);
    expect(s.modelSpec('legion')).toMatchObject({ kind: 'rig' });
    expect(errors).not.toHaveBeenCalled();
    const loaded = loader.loadAssets.mock.calls.flatMap(c => c[0]);
    expect(loaded).toContain('units/rome/legion.glb');
    expect(loaded).toContain(s.DEFAULT_MOUNT);
  });

  it('没有清单也能加载（只有代码建模要的马）', async () => {
    const s = await fresh();
    stubManifest(reply(null, { ok: false }));
    expect(await s.loadUnitModels()).toEqual([]);
    expect(loader.loadAssets.mock.calls.flatMap(c => c[0])).toEqual([s.DEFAULT_MOUNT]);
  });

  it('清单素材加载失败：返回失败的文件，用到它的模型退回代码建模，其余照用', async () => {
    const s = await fresh();
    stubManifest(reply(MANIFEST));
    failOn('units/rome/velites.glb');
    expect(await s.loadUnitModels()).toEqual(['units/rome/velites.glb']);
    expect(s.modelSpec('velites')).toBe(s.MODELS.velites);
    expect(s.modelSpec('legion')).toMatchObject({ kind: 'rig' });
    expect(s.modelSpec('equites')).toMatchObject({ kind: 'mounted' });
    expect(s.modelAssets()).not.toContain('units/rome/velites.glb');
    expect(errors).toHaveBeenCalled();
  });

  it('共用的动作库加载失败：用它的模型全部退回代码建模，不用它的不受影响', async () => {
    const s = await fresh();
    stubManifest(reply(MANIFEST));
    failOn('units/anims/human.glb');
    expect(await s.loadUnitModels()).toEqual(['units/anims/human.glb']);
    for (const id of ['legion', 'velites', 'equites']) expect(s.modelSpec(id), id).toBe(s.MODELS[id]);
    expect(s.modelSpec('onager')).toMatchObject({ kind: 'rig', src: 'units/rome/onager.glb' });
    expect(s.modelSpec('zzz')).toMatchObject({ kind: 'rig' });
  });

  it('骑兵的坐骑文件失败：这个骑兵退回代码建模', async () => {
    const s = await fresh();
    stubManifest(reply(MANIFEST));
    failOn('units/anims/horse.glb');
    expect(await s.loadUnitModels()).toEqual(['units/anims/horse.glb']);
    expect(s.modelSpec('equites')).toBe(s.MODELS.equites);
  });

  it('失败的文件是代码建模要用的马，即使清单里也登记了它：没有退路，抛错', async () => {
    const s = await fresh();
    const horse = s.DEFAULT_MOUNT;
    stubManifest(reply({
      libraries: MANIFEST.libraries,
      models: { equites: { kind: 'mounted', rider: { src: 'units/rome/equites.glb' }, mount: { src: horse } } },
    }));
    failOn(horse);
    await expect(s.loadUnitModels()).rejects.toThrow(/quaternius\/horse\.glb/);
    // 没有退路就不声称改用退路
    expect(errors).not.toHaveBeenCalled();
  });

  it('多个文件失败时一并返回', async () => {
    const s = await fresh();
    stubManifest(reply(MANIFEST));
    failOn('units/rome/velites.glb', 'units/rome/onager.glb');
    expect((await s.loadUnitModels()).sort()).toEqual(['units/rome/onager.glb', 'units/rome/velites.glb']);
  });

  it('代码建模自己要的素材（马）加载失败：没有退路，抛错', async () => {
    const s = await fresh();
    stubManifest(reply(MANIFEST));
    const horse = s.DEFAULT_MOUNT;
    failOn(horse);
    await expect(s.loadUnitModels()).rejects.toThrow(new RegExp(horse.replace('.', '\\.')));
  });

  it('清单素材与马一起失败时也抛错', async () => {
    const s = await fresh();
    stubManifest(reply(MANIFEST));
    failOn('units/rome/velites.glb', s.DEFAULT_MOUNT);
    await expect(s.loadUnitModels()).rejects.toThrow();
  });
});

describe('buildUnitModel / portraitHeight', () => {
  async function withManifest() {
    const s = await fresh();
    stubManifest(reply(MANIFEST));
    await s.loadModelManifest();
    return s;
  }

  it('清单登记的 rig 走 rigModel、mounted 走 mountedModel，传入清单与规格', async () => {
    const s = await withManifest();
    const a = fakeModel(1), b = fakeModel(2);
    gltf.rigModel.mockReturnValue(a);
    gltf.mountedModel.mockReturnValue(b);
    expect(s.buildUnitModel('legion')).toBe(a);
    expect(s.buildUnitModel('equites')).toBe(b);
    expect(gltf.rigModel.mock.calls[0][0]).toMatchObject({ libraries: MANIFEST.libraries });
    expect(gltf.rigModel.mock.calls[0][1]).toMatchObject({ src: 'units/rome/legion.glb' });
    expect(gltf.mountedModel.mock.calls[0][1]).toMatchObject({ kind: 'mounted' });
  });

  it('_e 没登记时沿用初级形态的素材烘焙', async () => {
    const s = await withManifest();
    gltf.rigModel.mockReturnValue(fakeModel());
    s.buildUnitModel('legion_e');
    expect(gltf.rigModel.mock.calls[0][1]).toMatchObject({ src: 'units/rome/legion.glb' });
  });

  it('没登记的模型 id 抛错', async () => {
    const s = await fresh();
    expect(() => s.buildUnitModel('nobody')).toThrow(/nobody/);
  });

  it('代码建模的模型直接烘焙，不碰素材加载', async () => {
    const s = await fresh();
    const m = s.buildUnitModel('legion');
    expect(m.height).toBeGreaterThan(0);
    expect(Object.keys(m.clips)).toContain('idle');
    expect(gltf.rigModel).not.toHaveBeenCalled();
  });

  it('素材烘焙出错：非 strict 时控制台报错并退回代码建模', async () => {
    const s = await withManifest();
    gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
    const m = s.buildUnitModel('legion');
    expect(Object.keys(m.clips)).toContain('idle');
    expect(m.height).toBeGreaterThan(0);
    expect(errors).toHaveBeenCalled();
  });

  it('退回之后会记住：再烘焙直接走代码建模，不再试素材；头像高度也按代码建模', async () => {
    const s = await withManifest();
    // 退回前按素材：portrait 3 米
    expect(s.portraitHeight('legion', 100)).toBe(3 * 10);
    gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
    s.buildUnitModel('legion');
    expect(gltf.rigModel).toHaveBeenCalledTimes(1);
    s.buildUnitModel('legion');
    expect(gltf.rigModel).toHaveBeenCalledTimes(1);
    const look = s.MODELS.legion;
    expect(look.kind).toBe('foot');
    expect(s.portraitHeight('legion', 100)).toBeCloseTo(19 * ((look as { human: { size?: number } }).human.size ?? 1), 6);
  });

  it('只退回烘焙失败的那个模型，别的模型照用素材', async () => {
    const s = await withManifest();
    gltf.rigModel.mockImplementation((_m, spec: { src: string }) => {
      if (spec.src.includes('legion')) throw new Error('坏素材');
      return fakeModel(7);
    });
    s.buildUnitModel('legion');
    expect(s.buildUnitModel('velites').height).toBe(7);
  });

  describe('高级形态（_e）的退路：先借初级形态的清单素材，初级也坏了才退代码建模', () => {
    const withBoth = async () => {
      const s = await fresh();
      stubManifest(reply({ ...MANIFEST, models: { ...MANIFEST.models, legion_e: RIG('units/rome/legion_e.glb', { portrait: 5 }) } }));
      await s.loadModelManifest();
      return s;
    };
    const srcOf = (c: unknown[]): string => (c[1] as { src: string }).src;

    it('自己登记的 _e 烘焙出错：借初级形态的素材，初级形态本身不受影响', async () => {
      const s = await withBoth();
      const base = fakeModel(9);
      gltf.rigModel.mockImplementation((_m, spec: { src: string }) => {
        if (spec.src.endsWith('legion_e.glb')) throw new Error('坏素材');
        return base;
      });
      expect(s.buildUnitModel('legion_e')).toBe(base);
      expect(gltf.rigModel.mock.calls.map(srcOf)).toEqual(['units/rome/legion_e.glb', 'units/rome/legion.glb']);
      // 记住了：再烘焙直接用初级形态的素材，头像高度也按它（portrait 3 米，不是 _e 自己的 5 米）
      gltf.rigModel.mockClear();
      expect(s.buildUnitModel('legion_e')).toBe(base);
      expect(gltf.rigModel.mock.calls.map(srcOf)).toEqual(['units/rome/legion.glb']);
      expect(s.portraitHeight('legion_e', 100)).toBe(3 * 10);
      expect(s.buildUnitModel('legion')).toBe(base);
      expect(errors).toHaveBeenCalled();
    });

    it('初级形态的素材也烘焙出错：_e 退回代码建模，不会无限递归', async () => {
      const s = await withBoth();
      gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
      const m = s.buildUnitModel('legion_e');
      expect(Object.keys(m.clips)).toContain('idle');
      // 退回后两个都记为已退回：之后直接走代码建模，不再碰素材
      gltf.rigModel.mockClear();
      s.buildUnitModel('legion_e');
      s.buildUnitModel('legion');
      expect(gltf.rigModel).not.toHaveBeenCalled();
      const look = s.MODELS.legion_e as { human: { size?: number } };
      expect(s.portraitHeight('legion_e', 100)).toBeCloseTo(19 * (look.human.size ?? 1), 6);
      expect((s.MODELS.legion as { human: { size?: number } }).human.size).not.toBe(look.human.size);
      expect(s.portraitHeight('legion', 100)).toBeCloseTo(19 * ((s.MODELS.legion as { human: { size?: number } }).human.size ?? 1), 6);
    });

    it('清单里没登记 _e（沿用初级形态素材）而素材烘焙出错：最终退回代码建模', async () => {
      const s = await fresh();
      stubManifest(reply(MANIFEST));
      await s.loadModelManifest();
      gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
      const m = s.buildUnitModel('legion_e');
      expect(Object.keys(m.clips)).toContain('idle');
      // 本来就在用初级形态的素材，没有别的可借：只试一次，直接走代码建模
      expect(gltf.rigModel).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledTimes(1);
      gltf.rigModel.mockClear();
      s.buildUnitModel('legion_e');
      expect(gltf.rigModel).not.toHaveBeenCalled();
      expect(s.portraitHeight('legion_e', 100)).toBeCloseTo(19 * ((s.MODELS.legion_e as { human: { size?: number } }).human.size ?? 1), 6);
    });

    it('初级形态 id 烘焙出错：直接退代码建模（不会去借别的素材）；_e 自己的素材照用', async () => {
      const s = await withBoth();
      gltf.rigModel.mockImplementation((_m, spec: { src: string }) => {
        if (spec.src.endsWith('legion.glb')) throw new Error('坏素材');
        return fakeModel(4);
      });
      const m = s.buildUnitModel('legion');
      expect(Object.keys(m.clips)).toContain('idle');
      expect(gltf.rigModel).toHaveBeenCalledTimes(1);
      expect(s.buildUnitModel('legion_e').height).toBe(4);
      expect(s.portraitHeight('legion_e', 100)).toBe(5 * 10);
    });

    describe('只登记在清单里、没有代码建模的 _e', () => {
      const manifestOnly = async (models: Record<string, unknown>) => {
        const s = await fresh();
        stubManifest(reply({ libraries: MANIFEST.libraries, models }));
        await s.loadModelManifest();
        expect(s.MODELS.zzz).toBeUndefined();
        expect(s.MODELS.zzz_e).toBeUndefined();
        return s;
      };
      const zzz = { kind: 'rig', src: 'units/zzz.glb' }, zzzE = { kind: 'rig', src: 'units/zzz_e.glb' };

      it('自己的素材烘焙出错：借初级形态的清单素材，不抛', async () => {
        const s = await manifestOnly({ zzz, zzz_e: zzzE });
        const base = fakeModel(6);
        gltf.rigModel.mockImplementation((_m, spec: { src: string }) => {
          if (spec.src.endsWith('zzz_e.glb')) throw new Error('坏素材');
          return base;
        });
        expect(s.buildUnitModel('zzz_e')).toBe(base);
        expect(errors).toHaveBeenCalled();
        gltf.rigModel.mockClear();
        expect(s.buildUnitModel('zzz_e')).toBe(base);
        expect(gltf.rigModel.mock.calls.map(c => (c[1] as { src: string }).src)).toEqual(['units/zzz.glb']);
      });

      it('初级形态的素材也出错：借不到、也没有代码建模，抛出原错误（不会无限递归）', async () => {
        const s = await manifestOnly({ zzz, zzz_e: zzzE });
        gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
        expect(() => s.buildUnitModel('zzz_e')).toThrow('坏素材');
        expect(gltf.rigModel.mock.calls.length).toBeLessThanOrEqual(3);
      });

      it('清单里没有初级形态可借：直接抛出，不走退路', async () => {
        const s = await manifestOnly({ zzz_e: zzzE });
        gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
        expect(() => s.buildUnitModel('zzz_e')).toThrow('坏素材');
        expect(gltf.rigModel).toHaveBeenCalledTimes(1);
        expect(errors).not.toHaveBeenCalled();
      });

      it('没登记 _e、沿用的初级形态素材出错：没有退路，抛出', async () => {
        const s = await manifestOnly({ zzz });
        gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
        expect(() => s.buildUnitModel('zzz_e')).toThrow('坏素材');
        // 本来就在用初级形态的素材，没有别的可借：只试一次，不打印「改用退路」
        expect(gltf.rigModel).toHaveBeenCalledTimes(1);
        expect(errors).not.toHaveBeenCalled();
      });

      it('借到初级形态素材之后，头像高度按初级形态的清单条目', async () => {
        const s = await manifestOnly({ zzz: { ...zzz, portrait: 2 }, zzz_e: { ...zzzE, portrait: 4 } });
        gltf.rigModel.mockImplementation((_m, spec: { src: string }) => {
          if (spec.src.endsWith('zzz_e.glb')) throw new Error('坏素材');
          return fakeModel(6);
        });
        expect(s.portraitHeight('zzz_e', 100)).toBe(4 * 10);
        s.buildUnitModel('zzz_e');
        expect(s.portraitHeight('zzz_e', 100)).toBe(2 * 10);
      });
    });

    it('strict：_e 烘焙出错直接抛出，不借初级形态', async () => {
      const s = await withBoth();
      gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
      expect(() => s.buildUnitModel('legion_e', true)).toThrow('坏素材');
      expect(gltf.rigModel).toHaveBeenCalledTimes(1);
    });
  });

  it('骑兵素材烘焙出错也退回代码建模', async () => {
    const s = await withManifest();
    gltf.mountedModel.mockImplementation(() => { throw new Error('没有 saddle'); });
    // 代码建模的骑兵要读马的 glTF（node 里没有加载），报出的是「马没加载」而不是素材的错，说明确实退到了代码建模
    expect(() => s.buildUnitModel('equites')).toThrow(/quaternius\/horse\.glb/);
    expect(gltf.mountedModel).toHaveBeenCalledTimes(1);
    expect(s.portraitHeight('equites', 100)).toBeCloseTo(28 * ((s.MODELS.equites as { size?: number }).size ?? 1), 6);
  });

  it('strict：烘焙出错直接抛出原错误，也不记为已退回', async () => {
    const s = await withManifest();
    gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
    expect(() => s.buildUnitModel('legion', true)).toThrow('坏素材');
    expect(gltf.rigModel).toHaveBeenCalledTimes(1);
    expect(() => s.buildUnitModel('legion', true)).toThrow('坏素材');
    expect(gltf.rigModel).toHaveBeenCalledTimes(2);
    // 之后非 strict 仍会先试素材
    s.buildUnitModel('legion');
    expect(gltf.rigModel).toHaveBeenCalledTimes(3);
  });

  it('没有代码建模可退（只在清单里登记的模型）：即使非 strict 也抛出原错误', async () => {
    const s = await withManifest();
    gltf.rigModel.mockImplementation(() => { throw new Error('坏素材'); });
    expect(s.MODELS.zzz).toBeUndefined();
    expect(() => s.buildUnitModel('zzz')).toThrow('坏素材');
  });

  it('头像高度：素材给了 portrait 按它，没给取模型高度（步兵上限 46、骑兵上限 28）', async () => {
    const s = await withManifest();
    expect(s.portraitHeight('legion', 100)).toBe(30);
    expect(s.portraitHeight('velites', 30)).toBe(30);
    expect(s.portraitHeight('velites', 80)).toBe(46);
    expect(s.portraitHeight('equites', 20)).toBe(20);
    expect(s.portraitHeight('equites', 80)).toBe(28);
  });

  it('头像高度（代码建模）：步兵 19 × 体型，骑兵 28 × 体型，器械取模型高度、上限 46', async () => {
    const s = await fresh();
    const foot = s.MODELS.legion as { human: { size?: number } };
    expect(s.portraitHeight('legion', 100)).toBeCloseTo(19 * (foot.human.size ?? 1), 6);
    expect(s.portraitHeight('auxilia', 100)).toBe(19);
    expect(s.portraitHeight('scorpio', 30)).toBe(30);
    expect(s.portraitHeight('scorpio', 90)).toBe(46);
  });
});
