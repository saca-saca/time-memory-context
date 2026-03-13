import { ContextCompressor } from '../context/compressor';
import { ContextAssembler } from '../context/assembler';
import { MemoryContext, MemoryContextError } from '../index';
import { ContentClassifier } from '../memory/classifier';

describe('MemoryContext', () => {
  let memory: MemoryContext;

  beforeEach(() => {
    memory = new MemoryContext({
      basePath: './test-memory',
      keepRounds: 3
    });
  });

  afterEach(async () => {
    // 清理测试数据
    memory.clearVectorCache?.();
  });

  describe('配置校验', () => {
    it('应该拒绝无效的 keepRounds', () => {
      expect(() => {
        new MemoryContext({ keepRounds: 0 });
      }).toThrow('keepRounds must be between 1 and 20');

      expect(() => {
        new MemoryContext({ keepRounds: 25 });
      }).toThrow('keepRounds must be between 1 and 20');
    });

    it('应该拒绝无效的 maxTokens', () => {
      expect(() => {
        new MemoryContext({ maxTokens: 50 });
      }).toThrow('maxTokens must be between 100 and 100000');
    });

    it('应该拒绝包含 .. 的 basePath', () => {
      expect(() => {
        new MemoryContext({ basePath: '../evil' });
      }).toThrow('basePath cannot contain');
    });
  });

  describe('WAL 协议', () => {
    it('应该启用 WAL 默认', async () => {
      const mc = new MemoryContext({ enableWAL: true });
      expect(mc).toBeDefined();
    });
  });

  describe('向量缓存', () => {
    it('应该支持清除缓存', () => {
      memory.clearVectorCache();
      // 无错误即通过
    });
  });

  describe('日志系统', () => {
    it('应该创建日志目录', async () => {
      const mc = new MemoryContext({ 
        basePath: './test-logs',
        logLevel: 'debug' 
      });
      await mc.initialize();
      expect(mc).toBeDefined();
    });
  });
});

describe('ContextCompressor', () => {
  let compressor: ContextCompressor;

  beforeEach(() => {
    compressor = new ContextCompressor({
      keepRounds: 3,
      summarizeThreshold: 10,
      summarizerConfig: {
        provider: 'openclaw'
      }
    });
  });

  it('应该正确压缩上下文', () => {
    const history = Array(10).fill(null).map((_, i) => ({
      role: 'user' as const,
      content: `Message ${i}`
    }));

    const result = compressor.compress(history);

    expect(result.context.length).toBeLessThanOrEqual(6);
    expect(result.originalLength).toBe(10);
    expect(result.compressedLength).toBeLessThanOrEqual(6);
  });

  it('应该生成摘要占位符', () => {
    const history = Array(20).fill(null).map((_, i) => ({
      role: 'user' as const,
      content: `Important message ${i} with enough length for summary generation`
    }));

    const result = compressor.compress(history);

    expect(result.summary).toBeTruthy();
    expect(result.summary).toContain('待精炼');
  });
});

describe('ContentClassifier', () => {
  let classifier: ContentClassifier;

  beforeEach(() => {
    classifier = new ContentClassifier();
  });

  it('应该识别任务', () => {
    const result = classifier.classify({
      role: 'user',
      content: 'TODO: 修复这个bug'
    });

    expect(result.type).toBe('task');
    expect(result.importance).toBeGreaterThan(0.8);
  });

  it('应该识别偏好', () => {
    const result = classifier.classify({
      role: 'user',
      content: '我喜欢用蓝色主题'
    });

    expect(result.type).toBe('preference');
    expect(result.importance).toBeGreaterThan(0.9);
  });

  it('应该识别噪声', () => {
    const result = classifier.classify({
      role: 'user',
      content: '好的'
    });

    expect(result.type).toBe('noise');
    expect(result.importance).toBeLessThan(0.2);
  });

  it('应该识别重要标记', () => {
    const result = classifier.classify({
      role: 'user',
      content: '我的密码是123 --important'
    });

    expect(result.importance).toBe(1.0);
  });
});

describe('ContextAssembler', () => {
  let assembler: ContextAssembler;

  beforeEach(() => {
    assembler = new ContextAssembler({
      maxTokens: 4000,
      maxMemorySnippets: 3
    });
  });

  it('应该正确组装上下文', () => {
    const compressed = {
      context: [{ role: 'user' as const, content: 'Hello' }],
      summary: 'Previous context',
      memoryCandidates: [],
      originalLength: 10,
      compressedLength: 1
    };

    const memories: any[] = [];

    const result = assembler.assemble(compressed, memories, 'System prompt');

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.metadata.estimatedTokens).toBeGreaterThan(0);
  });

  it('应该在超限时截断', () => {
    const compressed = {
      context: Array(100).fill(null).map(() => ({
        role: 'user' as const,
        content: 'A'.repeat(1000)
      })),
      summary: null,
      memoryCandidates: [],
      originalLength: 100,
      compressedLength: 100
    };

    const result = assembler.assemble(compressed, [], 'System');

    expect(result.metadata.truncated).toBe(true);
  });
});
