# 时序记忆上下文 (time-memory-context)

基于**时间分层**的记忆管理系统，通过**WAL协议 + BGE-M3向量化**，减少 80%+ Token 消耗。

## 核心特性

- ✅ **时序分层**：7天全量 → 30天精简 → 永久归档
- ✅ **WAL协议**：响应前先写入，防崩溃丢数据，保留30天
- ✅ **日志系统**：每日独立日志文件，保留7天
- ✅ **即时上下文**：3-5 轮对话，保证流畅
- ✅ **BGE-M3向量化**：1024维高质量语义检索，支持降级
- ✅ **API摘要生成**：支持 OpenClaw/OpenAI/自定义API
- ✅ **自动每日维护**：清理过期文件，性能可控

## 安装

```bash
# 从源码安装
cd time-memory-context
npm install
npm run build
npm link

# 或在项目中使用
npm install /path/to/time-memory-context
```

## 快速开始

```typescript
import { MemoryContext } from 'time-memory-context';

// 创建实例
const mc = new MemoryContext({
  keepRounds: 3,              // 保留最近3轮
  maxTokens: 2000,            // 最大token限制
  basePath: './memory',       // 存储路径
  enableWAL: true,            // 启用WAL协议
  logLevel: 'info',           // 日志级别
  summarizerConfig: {         // 摘要生成配置
    provider: 'openclaw',     // 或 'openai', 'custom'
    model: 'kimi-coding/k2p5'
  }
});

// 初始化目录
await mc.initialize();

// 处理消息
const result = await mc.process(
  "用户的问题",
  history,  // 对话历史
  "System prompt..."
);

console.log(`Token节省: ${result.metadata.savings}%`);
console.log(`检索到记忆: ${result.metadata.memoryCount}条`);

// 使用组装好的上下文调用模型
const response = await model.generate(result.messages);

// 记录助手回复（带WAL）
await mc.recordAssistant(response);
```

## Token 节省效果

| 场景 | Token 节省 |
|-----|-----------|
| 20轮日常对话 | 80% |
| 50轮项目讨论 | 85% |
| 跨30天跟进 | 92% |

## 目录结构

```
memory/
├── daily/           # 每日文件 (0-7天)
│   ├── 2026-03-09.json
│   └── 2026-03-02.json (已清理)
├── archive/         # 月度归档 (30天+)
│   └── 2026-02.jsonl
├── wal/             # WAL预写日志 (保留30天)
│   └── 2026-03-09.jsonl
├── logs/            # 每日日志 (保留7天)
│   └── 2026-03-09.jsonl
└── vectors/         # 向量索引 (预留)
```

## CLI 工具

```bash
# 执行每日维护（清理7天、归档30天、清理WAL和日志）
npm run maintenance

# 查看统计
npx time-memory-context stats

# 查看系统状态（含Ollama检测）
npx time-memory-context status

# 查询记忆
npx time-memory-context recall "上周说的方案"

# 或使用简写
npx tmc recall "数据库配置"
```

## 配置

### 完整配置示例

```typescript
import { MemoryContext } from 'time-memory-context';

const mc = new MemoryContext({
  // 上下文配置
  keepRounds: 3,              // 保留最近N轮 (默认3)
  maxTokens: 4000,            // 最大token限制 (默认4000)
  
  // 存储配置
  basePath: './memory',       // 存储路径 (默认./memory)
  
  // 功能开关
  enableRetrieval: true,      // 启用记忆检索 (默认true)
  enableWAL: true,            // 启用WAL协议 (默认true)
  enableVectorCache: true,    // 启用向量缓存 (默认true)
  
  // 日志配置
  logLevel: 'info',           // 日志级别: debug/info/warn/error
  
  // 摘要生成配置 (可选)
  summarizerConfig: {
    provider: 'openclaw',     // 'openclaw' | 'openai' | 'custom'
    apiKey: '...',            // OpenAI或自定义API时需要
    baseUrl: '...',           // 自定义API时需要
    model: 'kimi-coding/k2p5', // 模型名称
    maxLength: 200            // 最大摘要长度
  }
});
```

### 配置文件

也可以使用 `config/default.json`：

```json
{
  "context": {
    "keepRounds": 3,
    "maxTokens": 2000
  },
  "memory": {
    "basePath": "./memory",
    "tiers": {
      "short": { "days": 7, "compression": "none" },
      "medium": { "days": 30, "compression": "clean" },
      "long": { "compression": "archive" }
    }
  },
  "vector": {
    "model": "bge-m3:latest",
    "dimensions": 1024
  },
  "wal": {
    "enabled": true,
    "retentionDays": 30
  },
  "logging": {
    "level": "info",
    "retentionDays": 7
  },
  "summarizer": {
    "provider": "openclaw",
    "model": "kimi-coding/k2p5"
  }
}
```

## 使用技巧

### 标记重要信息
```
用户: 记住我的API密钥是xxx --important
```
`--important` 标记会让信息绕过清理规则，直接进入长期记忆。

### 手动查询记忆
```typescript
const memories = await mc.recall("数据库配置", 5);
for (const m of memories) {
  console.log(`[${m.tier}] ${m.source}: ${m.content}`);
}
```

### 定时维护
建议通过 cron 每天凌晨执行：
```bash
0 3 * * * cd /path/to/project && npx time-memory-context maintenance
```

## 工作原理

1. **WAL协议**：响应前先写入 `wal/YYYY-MM-DD.jsonl`，防崩溃丢数据
2. **上下文压缩**：只保留最近3-5轮对话，老对话调用API生成摘要
3. **分层存储**：
   - 0-7天：全量保留，文件存储，关键词检索
   - 7-30天：BGE-M3向量语义检索
   - 30天+：归档摘要，主题检索
4. **智能清理**：基于内容价值判断（任务>偏好>事实>对话>噪声）
5. **记忆卫生**：自动去重，相似度>0.8视为重复

## 依赖

- **Ollama**：运行 `bge-m3:latest` 模型进行向量化
  ```bash
  ollama pull bge-m3
  ollama serve
  ```

## API 文档

### MemoryContext

#### `constructor(config?: Partial<MemoryContextConfig>)`
创建实例

#### `initialize(): Promise<void>`
初始化存储目录（创建 daily/archive/wal/logs/vectors）

#### `process(message, history, systemPrompt?): Promise<ProcessResult>`
处理消息，返回组装好的上下文

#### `recordAssistant(message): Promise<void>`
记录助手回复（带WAL）

#### `markImportant(content, note?): Promise<void>`
标记重要信息

#### `recall(query, topK?): Promise<MemorySnippet[]>`
查询记忆

#### `maintenance(): Promise<MaintenanceResult>`
执行每日维护（清理7天、归档30天、清理WAL和日志）

#### `getStats(): Promise<MemoryStats>`
获取统计信息

#### `clearVectorCache(): void`
清除向量缓存

## 测试

```bash
npm test
npm run test:watch
```

## 许可

MIT
