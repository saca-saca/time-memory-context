#!/bin/bash
# Time Memory Context - 自动压缩辅助脚本
# 用于在对话中自动判断和执行上下文压缩

set -e

# 默认配置（可被环境变量覆盖）
ROUND_THRESHOLD=${TMC_ROUND_THRESHOLD:-10}
TOKEN_THRESHOLD=${TMC_TOKEN_THRESHOLD:-3000}
FORCE_THRESHOLD=${TMC_FORCE_THRESHOLD:-20}
KEEP_ROUNDS=${TMC_KEEP_ROUNDS:-3}

# 计算对话轮数的简单估算
# 参数: $1 = 历史对话 JSON
count_rounds() {
    local history="$1"
    echo "$history" | jq '[.[] | select(.role == "user")] | length'
}

# 估算 Token 数（简单启发式：中文约 2 字符/token，英文约 4 字符/token）
# 参数: $1 = 历史对话 JSON
estimate_tokens() {
    local history="$1"
    local total_chars=$(echo "$history" | jq -r '[.[].content] | join("") | length')
    # 保守估计：每 2 个字符约 1 个 token
    echo $(( total_chars / 2 ))
}

# 检查是否需要压缩
# 参数: $1 = 历史对话 JSON
# 返回: "yes" 或 "no"
should_compress() {
    local history="$1"

    local rounds=$(count_rounds "$history")
    local tokens=$(estimate_tokens "$history")

    # 强制压缩
    if [ "$rounds" -ge "$FORCE_THRESHOLD" ]; then
        echo "yes"
        return
    fi

    # 轮数阈值
    if [ "$rounds" -ge "$ROUND_THRESHOLD" ]; then
        echo "yes"
        return
    fi

    # Token 阈值
    if [ "$tokens" -ge "$TOKEN_THRESHOLD" ]; then
        echo "yes"
        return
    fi

    echo "no"
}

# 获取压缩建议
# 参数: $1 = 历史对话 JSON
get_compression_advice() {
    local history="$1"
    local rounds=$(count_rounds "$history")
    local tokens=$(estimate_tokens "$history")

    cat <<EOF
{
  "should_compress": $(if [ "$(should_compress "$history")" = "yes" ]; then echo "true"; else echo "false"; fi),
  "current_rounds": $rounds,
  "estimated_tokens": $tokens,
  "thresholds": {
    "round": $ROUND_THRESHOLD,
    "token": $TOKEN_THRESHOLD,
    "force": $FORCE_THRESHOLD
  },
  "recommendation": $(if [ "$(should_compress "$history")" = "yes" ]; then echo '"建议立即压缩上下文"'; else echo '"暂不需要压缩"'; fi)
}
EOF
}

# 主命令
COMMAND="${1:-help}"

case "$COMMAND" in
    check)
        # 检查是否需要压缩
        # 用法: auto-tmc.sh check '[{"role":"user",...}]'
        HISTORY="${2:-[]}"
        should_compress "$HISTORY"
        ;;
    
    advice)
        # 获取压缩建议（JSON 格式）
        # 用法: auto-tmc.sh advice '[{"role":"user",...}]'
        HISTORY="${2:-[]}"
        get_compression_advice "$HISTORY"
        ;;
    
    stats)
        # 显示当前统计
        # 用法: auto-tmc.sh stats '[{"role":"user",...}]'
        HISTORY="${2:-[]}" 
        rounds=$(count_rounds "$HISTORY")
        tokens=$(estimate_tokens "$HISTORY")
        echo "当前对话统计:"
        echo "  轮数: $rounds / $ROUND_THRESHOLD (强制: $FORCE_THRESHOLD)"
        echo "  预估 Token: $tokens / $TOKEN_THRESHOLD"
        echo "  建议: $(if [ "$(should_compress "$HISTORY")" = "yes" ]; then echo "🔴 建议压缩"; else echo "🟢 无需压缩"; fi)"
        ;;
    
    config)
        # 显示当前配置
        echo "Time Memory Context 自动压缩配置:"
        echo "  轮数阈值: $ROUND_THRESHOLD 轮"
        echo "  Token 阈值: $TOKEN_THRESHOLD tokens"
        echo "  强制压缩: $FORCE_THRESHOLD 轮"
        echo "  保留轮数: $KEEP_ROUNDS 轮"
        echo ""
        echo "环境变量覆盖:"
        echo "  TMC_ROUND_THRESHOLD - 设置轮数阈值"
        echo "  TMC_TOKEN_THRESHOLD - 设置 Token 阈值"
        echo "  TMC_FORCE_THRESHOLD - 设置强制压缩轮数"
        echo "  TMC_KEEP_ROUNDS - 设置保留轮数"
        ;;
    
    compress)
        # 实际执行压缩
        # 用法: auto-tmc.sh compress '[{"role":"user",...}]' '用户新消息' '系统提示'
        HISTORY="${2:-[]}"
        USER_MSG="${3:-}"
        SYSTEM_PROMPT="${4:-你是一个有帮助的助手}"
        
        if [ -z "$USER_MSG" ]; then
            echo "❌ 用法: auto-tmc.sh compress '[历史JSON]' '用户新消息' '[系统提示]'"
            exit 1
        fi
        
        echo "🔄 正在压缩上下文..."
        RESULT=$(time-memory-context process "$USER_MSG" \
            --history "$HISTORY" \
            --system "$SYSTEM_PROMPT" \
            --output-format json 2>/dev/null)
        
        if [ $? -ne 0 ]; then
            echo "❌ 压缩失败，请检查 time-memory-context 是否已安装"
            exit 1
        fi
        
        # 输出统计信息
        MSG_COUNT=$(echo "$RESULT" | jq '.messages | length')
        TOKEN_EST=$(echo "$RESULT" | jq '.metadata.estimatedTokens')
        SAVINGS=$(echo "$RESULT" | jq '.metadata.savings')
        MEM_COUNT=$(echo "$RESULT" | jq '.metadata.memoryCount')
        
        echo "✅ 压缩完成"
        echo ""
        echo "📊 统计:"
        echo "  - 消息数量: $MSG_COUNT 条"
        echo "  - 估算 Token: $TOKEN_EST"
        echo "  - Token 节省: $SAVINGS%"
        echo "  - 检索记忆: $MEM_COUNT 条"
        echo ""
        echo "📤 压缩后的 messages 数组:"
        echo "$RESULT" | jq '.messages'
        ;;
    
    auto)
        # 自动模式：检查 → 压缩(如果需要) → 返回结果
        # 用法: auto-tmc.sh auto '[{"role":"user",...}]' '用户新消息' '[系统提示]' '[助手回复]'
        HISTORY="${2:-[]}"
        USER_MSG="${3:-}"
        SYSTEM_PROMPT="${4:-你是一个有帮助的助手}"
        ASSISTANT_REPLY="${5:-}"
        
        if [ -z "$USER_MSG" ]; then
            echo "❌ 用法: auto-tmc.sh auto '[历史JSON]' '用户新消息' '[系统提示]' '[助手回复]'"
            exit 1
        fi
        
        # 检查是否需要压缩
        NEED_COMPRESS=$(should_compress "$HISTORY")
        
        if [ "$NEED_COMPRESS" = "yes" ]; then
            echo "🔄 检测到需要压缩，正在处理..."
            RESULT=$(time-memory-context process "$USER_MSG" \
                --history "$HISTORY" \
                --system "$SYSTEM_PROMPT" \
                --output-format json 2>/dev/null)
            
            if [ $? -ne 0 ]; then
                echo "❌ 处理失败"
                exit 1
            fi
            
            SAVINGS=$(echo "$RESULT" | jq '.metadata.savings')
            echo "✅ 上下文已压缩，Token 节省: $SAVINGS%"
            echo "$RESULT" | jq '.messages'
        else
            echo "🟢 无需压缩，使用原始上下文"
            # 直接输出原始历史
            echo "$HISTORY" | jq '{
                "messages": .,
                "metadata": {
                    "compressed": false,
                    "savings": 0
                }
            }'
        fi
        
        # 如果有助手回复，自动记录
        if [ -n "$ASSISTANT_REPLY" ]; then
            echo ""
            echo "📝 正在记录助手回复..."
            time-memory-context record "$ASSISTANT_REPLY" 2>/dev/null
            if [ $? -eq 0 ]; then
                echo "✅ 已记录到记忆"
            else
                echo "⚠️ 记录失败"
            fi
        fi
        ;;
    
    help|*)
        cat <<EOF
Time Memory Context - 自动压缩辅助脚本

用法:
  auto-tmc.sh check '[历史JSON]'         - 检查是否需要压缩 (返回 yes/no)
  auto-tmc.sh advice '[历史JSON]'        - 获取压缩建议 (JSON 格式)
  auto-tmc.sh stats '[历史JSON]'         - 显示对话统计
  auto-tmc.sh compress '[历史]' '消息'   - 执行实际压缩
  auto-tmc.sh auto '[历史]' '消息' '系统' '回复' - 自动模式(检查+压缩+记录)
  auto-tmc.sh config                     - 显示当前配置

环境变量:
  TMC_ROUND_THRESHOLD  - 轮数阈值 (默认: 10)
  TMC_TOKEN_THRESHOLD  - Token 阈值 (默认: 3000)
  TMC_FORCE_THRESHOLD  - 强制压缩轮数 (默认: 20)
  TMC_KEEP_ROUNDS      - 保留轮数 (默认: 3)

示例:
  auto-tmc.sh check '[{"role":"user","content":"你好"}]'
  auto-tmc.sh advice "\$(cat history.json)"
  auto-tmc.sh compress '[...]' "新消息" "系统提示"
  auto-tmc.sh auto '[...]' "用户消息" "系统提示" "助手回复"
  TMC_ROUND_THRESHOLD=5 auto-tmc.sh stats '[...]'
EOF
        ;;
esac
