#!/bin/bash
# smart-context.sh - 使用 time-memory-context 实现自动记录 + 自动压缩的完整示例
# 用法: ./smart-context.sh "用户消息" '[历史对话JSON]' "[系统提示]"

USER_MSG="${1:-}"
HISTORY="${2:-[]}"
SYSTEM_PROMPT="${3:-你是一个有帮助的助手}"

if [ -z "$USER_MSG" ]; then
  echo "用法: $0 \"用户消息\" '[历史对话JSON]' \"[系统提示]\""
  echo ""
  echo "示例:"
  echo "  $0 \"帮我总结一下\" '[{\"role\":\"user\",\"content\":\"你好\"}]' \"你是助手\""
  echo ""
  echo "完整流程（自动记录 + 自动压缩）:"
  echo "  1. 检查是否需要压缩"
  echo "  2. 调用 process() 处理（可能触发压缩）"
  echo "  3. 将优化后的 messages 发给 LLM"
  echo "  4. 得到回复后，运行: time-memory-context record \"助手回复内容\""
  exit 1
fi

# 步骤 1: 检查是否需要压缩
echo "🔍 检查上下文状态..."
ROUNDS=$(echo "$HISTORY" | jq '[.[] | select(.role == "user")] | length')
TOKENS=$(echo "$HISTORY" | jq -r '[.[].content] | join("") | length')
TOKENS=$(( TOKENS / 2 ))

echo "  - 当前轮数: $ROUNDS"
echo "  - 预估 Token: $TOKENS"

NEED_COMPRESS="no"
if [ "$ROUNDS" -ge 10 ] || [ "$TOKENS" -ge 3000 ] || [ "$ROUNDS" -ge 20 ]; then
  NEED_COMPRESS="yes"
  echo "  - 结果: 🔴 需要压缩"
else
  echo "  - 结果: 🟢 无需压缩"
fi

# 步骤 2: 调用 time-memory-context 处理
echo ""
echo "🔄 处理消息..."
RESULT=$(time-memory-context process "$USER_MSG" \
  --history "$HISTORY" \
  --system "$SYSTEM_PROMPT" \
  --output-format json 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "❌ 调用失败，可能 time-memory-context 未安装"
  echo "   安装: npm install -g time-memory-context"
  exit 1
fi

# 提取统计信息
MSG_COUNT=$(echo "$RESULT" | jq '.messages | length')
TOKEN_EST=$(echo "$RESULT" | jq '.metadata.estimatedTokens')
SAVINGS=$(echo "$RESULT" | jq '.metadata.savings')
MEM_COUNT=$(echo "$RESULT" | jq '.metadata.memoryCount')

echo "✅ 处理完成"
echo ""
echo "📊 统计:"
echo "  - 消息数量: $MSG_COUNT 条"
echo "  - 估算 Token: $TOKEN_EST"
echo "  - Token 节省: $SAVINGS%"
echo "  - 检索记忆: $MEM_COUNT 条"
echo ""
echo "📤 输出 (messages 数组):"
echo "$RESULT" | jq '.messages'

# 步骤 3: 记录助手回复的辅助命令
echo ""
echo "💡 下一步:"
echo "  1. 将上述 messages 发给 LLM"
echo "  2. 得到回复后，**必须执行**:"
echo ""
echo "     time-memory-context record \"助手回复内容\""
echo ""
echo "  ⚠️  注意: 无论是否压缩，每次回复后都要记录！"
echo ""
echo "或者使用 auto 模式一次性完成:"
echo "  ./auto-tmc.sh auto '[历史]' '用户消息' '系统提示' '助手回复'"
