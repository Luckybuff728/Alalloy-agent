/**
 * useChatScroll.js - 聊天面板滚动管理 Composable
 * 
 * 职责：
 * - 维护“锁定底部”状态 (isLocked)
 * - 监听内容高度变化 (scrollHeight 轮询)
 * - 触发丝滑滚动
 * - 智能识别用户手动打断逻辑
 * 
 * 设计原则：
 * - 用户不操作时：自动跟随新内容到底部
 * - 用户向上滚动：解除锁定，停止自动跟随
 * - 用户滚回底部：重新锁定，恢复自动跟随
 */
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'

export function useChatScroll(containerRef) {
  // ==================== 状态 ====================
  const isLocked = ref(true)      // 是否锁定到底部（自动跟随新消息）
  const isNearBottom = ref(true)  // 是否靠近底部（用于显示"回到底部"按钮）
  
  // ==================== 配置 ====================
  const SCROLL_THRESHOLD = 80     // 距离底部多少 px 认为“在底部”
  const POLL_INTERVAL = 100       // scrollHeight 检测间隔 (ms)
  
  // ==================== 内部变量 ====================
  let lastScrollHeight = 0        // 上次记录的内容高度
  let pollTimer = null            // scrollHeight 轮询定时器
  let scrollEndTimer = null       // 滚动结束检测定时器
  let isProgrammaticScroll = false // 是否为程序触发的滚动

  // ==================== 核心方法 ====================
  
  /**
   * 检查当前滚动位置，更新锁定状态
   */
  const checkScrollPosition = () => {
    if (!containerRef.value) return
    
    const { scrollTop, scrollHeight, clientHeight } = containerRef.value
    const distanceToBottom = scrollHeight - scrollTop - clientHeight
    
    // 是否在底部附近
    const atBottom = distanceToBottom < SCROLL_THRESHOLD
    isNearBottom.value = atBottom
    
    // 双向锁定逻辑
    if (atBottom && !isLocked.value) {
      // 用户滚回底部 → 重新锁定
      isLocked.value = true
      console.log('[ChatScroll] 用户滚回底部，重新锁定自动跟随')
    } else if (!atBottom && isLocked.value && !isProgrammaticScroll) {
      // 用户手动向上滚动 → 解锁
      isLocked.value = false
      console.log('[ChatScroll] 用户手动向上滚动，解锁跟随')
    }
  }

  /**
   * 滚动到底部
   * @param {string} behavior - 'auto' 或 'smooth'
   */
  const scrollToBottom = (behavior = 'auto') => {
    if (!containerRef.value) return
    
    isProgrammaticScroll = true
    const validBehavior = behavior === 'smooth' ? 'smooth' : 'auto'
    
    containerRef.value.scrollTo({
      top: containerRef.value.scrollHeight,
      behavior: validBehavior
    })
    
    // 立即更新状态
    isNearBottom.value = true
    
    // 延迟解除标志位
    const delay = validBehavior === 'smooth' ? 400 : 50
    setTimeout(() => {
      isProgrammaticScroll = false
    }, delay)
  }

  /**
   * 强制锁定并滚动到底部（用户点击按钮或发送消息时调用）
   */
  const forceScroll = () => {
    isLocked.value = true
    nextTick(() => scrollToBottom('smooth'))
  }

  // ==================== 事件处理 ====================
  
  /**
   * 处理用户滚动事件（带防抖）
   */
  const handleScroll = () => {
    if (scrollEndTimer) {
      clearTimeout(scrollEndTimer)
    }
    
    // 滚动结束 100ms 后检测状态
    scrollEndTimer = setTimeout(() => {
      checkScrollPosition()
    }, 100)
  }

  /**
   * 检测内容高度变化（替代 ResizeObserver）
   * 原因：ResizeObserver 监听容器无效，因为容器是 flex:1 高度固定
   */
  const checkContentHeight = () => {
    if (!containerRef.value) return
    
    const currentHeight = containerRef.value.scrollHeight
    
    // 内容高度发生变化
    if (currentHeight !== lastScrollHeight) {
      lastScrollHeight = currentHeight
      
      // 如果处于锁定状态，自动滚动到底部
      if (isLocked.value) {
        // 使用 nextTick 确保 DOM 更新完成
        nextTick(() => {
          scrollToBottom('auto')
        })
      }
    }
  }

  /**
   * 启动内容高度检测轮询
   */
  const startPolling = () => {
    if (pollTimer) return
    
    // 记录初始高度
    if (containerRef.value) {
      lastScrollHeight = containerRef.value.scrollHeight
    }
    
    // 定时检测内容高度变化
    pollTimer = setInterval(checkContentHeight, POLL_INTERVAL)
  }

  /**
   * 停止轮询
   */
  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // ==================== 生命周期 ====================
  
  onMounted(() => {
    if (containerRef.value) {
      // 监听用户滚动事件
      containerRef.value.addEventListener('scroll', handleScroll, { passive: true })
      
      // 启动内容高度检测
      startPolling()
      
      // 初始滚动到底部
      scrollToBottom('auto')
    }
  })

  onUnmounted(() => {
    // 清理事件监听
    if (containerRef.value) {
      containerRef.value.removeEventListener('scroll', handleScroll)
    }
    
    // 停止轮询
    stopPolling()
    
    // 清理定时器
    if (scrollEndTimer) {
      clearTimeout(scrollEndTimer)
    }
  })

  // ==================== 导出 ====================
  
  return {
    isLocked,
    isNearBottom,
    scrollToBottom,
    forceScroll,
    // 不再导出 updateScrollState，改用内部 handleScroll
  }
}
