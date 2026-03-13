---
name: time-memory-context
description: |
  时序记忆上下文管理技能。通过压缩历史对话、检索相关记忆，减少 80%+ 的 Token 消耗。
  
  何时使用：
  - 对话轮数超过 10 轮，需要压缩上下文
  - 需要跨会话检索历史信息
  - 想要减少 Token 费用
  
  关键词：压缩上下文、减少Token、记忆检索、对话历史、Token优化
homepage: https://github.com/saca-saca/time-memory-context
metadata:
  openclaw:
    emoji: 🧠
    requires:
      node: ">=18.0.0"
    install:
      - id: npm-install
        kind: npm
        package: "time-memory-context"
        global: true
        label: "Install time-memory-context globally"
---

# 时序记忆上下文 (Time Memory Context)

**核心能力：减少 80%+ Token 消耗，同时保持对话连贯性**

完整文档见 [README.md](./README.md)

## 快速使用

### 场景：对话太长，压缩后发给 LLM

```bash
# 1. 调用技能处理
RESULT=$(time-memory-context process "我的新问题" \
  --history '[{"role":"user","content":"你好"},...]' \
  --system "你是代码助手" \
  --output-format json)

# 2. 提取优化后的 messages（Token 减少 80%+）
MESSAGES=$(echo $RESULT | jq '.messages')

# 3. 回复后记录到记忆
time-memory-context record "助手回复内容"
```

### 使用辅助脚本检查是否需要压缩

```bash
# 检查当前对话是否需要压缩
./auto-tmc.sh check '[{"role":"user","content":"你好"},...]'
# 输出: yes 或 no

# 获取压缩建议
./auto-tmc.sh advice '[历史对话JSON]'

# 查看统计
./auto-tmc.sh stats '[历史对话JSON]'
```

## 初始化配置（推荐）

在 `SOUL.md` 中配置以下规则，实现**自动记录 + 自动压缩**的完整记忆流程。

### 双重记录机制

同时启用 **time-memory-context** 和 **MEMORY.md** 两种记录方式：

| 方式 | 用途 | 频率 |
|------|------|------|
| **time-memory-context** | 机器可读、自动分层、语义检索 | **每次对话自动记录** |
| **MEMORY.md** | 人类可读、关键决策、长期保留 | 重要时手动/批量更新 |

### 自动记录规则（每次对话都执行）

**执行流程**：
```
用户消息
   ↓
process() [可能触发压缩]
   ↓
生成回复
   ↓
time-memory-context record "回复内容"  ← 每次都必须执行
   ↓
返回给用户
```

**配置要点**：
- 无论是否压缩，**每次回复后都执行 `record`**
- 写入 WAL 预写日志，防崩溃丢数据
- 自动分层：0-7天全量 → 7-30天向量 → 30天+归档

### 自动压缩规则（条件触发）

**核心原则**：检查时机在 `process()` 阶段，**不影响记录**

**触发阈值**：
| 条件 | 阈值 | 行为 |
|------|------|------|
| 对话轮数 | ≥ 10 轮 | 检查是否压缩 |
| 预估 Token | ≥ 3000 | 检查是否压缩 |
| 强制压缩 | ≥ 20 轮 | **无视 Token 数，强制压缩** |

**不压缩的情况**：
- 轮数 < 10 且 Token < 3000
- 用户明确说"不要压缩"
- 当前是代码/复杂逻辑讨论

### 快速配置模板

```markdown
## 🧠 记忆系统配置

### 自动记录（每次对话）
- 每次回复后执行: `time-memory-context record "回复内容"`
- 存储路径: `./memory/`
- WAL 保留: 30天

### 自动压缩（条件触发）
- 轮数阈值: 10 轮
- Token 阈值: 3000 tokens  
- 强制压缩: 20 轮
- 保留轮数: 3-5 轮

### MEMORY.md 更新规则
- 用户说"记住这个" → 立即更新
- 重要决策/约定 → 立即更新
- 日常对话 → 定期从 time-memory-context 提炼
```

## CLI 命令

```bash
# 核心：处理消息
 time-memory-context process "消息" --history "[...]" --output-format json

# 记录回复
time-memory-context record "回复"

# 查询记忆
time-memory-context recall "关键词"

# 维护
time-memory-context maintenance
time-memory-context status
```

## Token 节省效果

| 对话长度 | 原始 Token | 优化后 | 节省 |
|---------|-----------|--------|------|
| 10 轮 | ~2,000 | ~400 | **80%** |
| 20 轮 | ~4,000 | ~600 | **85%** |
| 50 轮 | ~10,000 | ~1,000 | **90%** |

## 安装

```bash
# 方式 1：使用 install.sh
./install.sh

# 方式 2：手动安装
npm install -g time-memory-context

# 验证
time-memory-context --version
```

## 依赖

- Node.js >= 18.0.0
- Ollama (可选，用于向量检索): `ollama pull bge-m3`

完整文档、配置说明、API 文档见 [README.md](./README.md)
