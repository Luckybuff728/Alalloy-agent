/**
 * WebSocket通信组合式函数 - 增强版
 * 特性：心跳保活、自动重连、离线消息队列
 */
import { ref, onUnmounted } from 'vue'

// 重连配置
const RECONNECT_CONFIG = {
  initialDelay: 1000,      // 初始重连延迟（毫秒）
  maxDelay: 30000,         // 最大重连延迟
  backoffMultiplier: 1.5,  // 退避倍数
  maxAttempts: 10          // 最大重连次数
}

// 心跳配置
const HEARTBEAT_CONFIG = {
  interval: 30000,          // 心跳间隔（30秒）
  timeout: 60000,           // 标准心跳超时（60秒）
  longTimeout: 120000        // 长任务心跳超时（90秒） - 业务调整：缩短至90秒以提高响应速度
}

export function useWebSocket() {
  const ws = ref(null)
  const isConnected = ref(false)
  const messageHandler = ref(null)

  // 重连状态
  const reconnectAttempts = ref(0)
  const reconnectTimer = ref(null)
  const shouldReconnect = ref(true)

  // 心跳状态
  const heartbeatTimer = ref(null)
  const heartbeatTimeoutTimer = ref(null)

  // 离线消息队列
  const offlineQueue = ref([])

  // 连接信息
  const currentUrl = ref(null)
  const connectionState = ref('disconnected') // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

  // 心跳状态管理
  const isProcessingLongTask = ref(false)
  const longTaskStartTime = ref(null)

  /**
   * 设置长时间任务状态（用于延长心跳超时）
   */
  const setLongTaskStatus = (isLongTask) => {
    isProcessingLongTask.value = isLongTask
    if (isLongTask) {
      longTaskStartTime.value = Date.now()
    } else {
      longTaskStartTime.value = null
    }
  }

  /**
   * 启动心跳机制
   */
  const startHeartbeat = () => {
    stopHeartbeat()

    heartbeatTimer.value = setInterval(() => {
      if (ws.value && ws.value.readyState === WebSocket.OPEN) {
        // 发送ping消息
        ws.value.send(JSON.stringify({ type: 'ping' }))

        // 根据任务状态动态调整超时时间
        let timeout = HEARTBEAT_CONFIG.timeout
        if (isProcessingLongTask.value) {
          // 长时间任务期间，延长超时至90秒（业务场景：90秒无响应即可认为连接异常）
          timeout = HEARTBEAT_CONFIG.longTimeout
        }

        // 设置心跳超时
        heartbeatTimeoutTimer.value = setTimeout(() => {
          console.warn('[WebSocket] 心跳超时（检测到网络异常或后端失联），执行断开')
          ws.value?.close()
        }, timeout)
      }
    }, HEARTBEAT_CONFIG.interval)
  }

  /**
   * 停止心跳
   */
  const stopHeartbeat = () => {
    if (heartbeatTimer.value) {
      clearInterval(heartbeatTimer.value)
      heartbeatTimer.value = null
    }
    if (heartbeatTimeoutTimer.value) {
      clearTimeout(heartbeatTimeoutTimer.value)
      heartbeatTimeoutTimer.value = null
    }
  }

  /**
   * 处理心跳响应
   */
  const handleHeartbeatResponse = () => {
    // 收到pong，清除超时定时器
    if (heartbeatTimeoutTimer.value) {
      clearTimeout(heartbeatTimeoutTimer.value)
      heartbeatTimeoutTimer.value = null
    }
  }

  /**
   * 计算重连延迟（指数退避）
   */
  const getReconnectDelay = () => {
    const delay = RECONNECT_CONFIG.initialDelay *
      Math.pow(RECONNECT_CONFIG.backoffMultiplier, reconnectAttempts.value)
    return Math.min(delay, RECONNECT_CONFIG.maxDelay)
  }

  /**
   * 重连逻辑
   */
  const scheduleReconnect = () => {
    if (!shouldReconnect.value) {
      console.log('[WebSocket] 已禁用自动重连')
      return
    }

    if (reconnectAttempts.value >= RECONNECT_CONFIG.maxAttempts) {
      console.error('[WebSocket] 达到最大重连次数，停止重连')
      connectionState.value = 'disconnected'
      return
    }

    const delay = getReconnectDelay()
    reconnectAttempts.value++

    connectionState.value = 'reconnecting'

    reconnectTimer.value = setTimeout(() => {
      if (currentUrl.value) {
        connectInternal(currentUrl.value, messageHandler.value)
      }
    }, delay)
  }

  /**
   * 发送离线队列中的消息
   */
  const flushOfflineQueue = () => {
    if (offlineQueue.value.length > 0) {
      offlineQueue.value.forEach(data => {
        if (ws.value && ws.value.readyState === WebSocket.OPEN) {
          ws.value.send(JSON.stringify(data))
        }
      })

      offlineQueue.value = []
    }
  }

  /**
   * 内部连接方法
   */
  const connectInternal = (url, onMessage) => {
    // 防止重复连接
    if (ws.value) {
      if (ws.value.readyState === WebSocket.OPEN) {
        console.warn('[WebSocket] 已有活动连接，跳过重复连接')
        return
      } else if (ws.value.readyState === WebSocket.CONNECTING) {
        console.warn('[WebSocket] 正在连接中，跳过重复连接')
        return
      } else {
        console.log('[WebSocket] 清理旧连接')
        ws.value.close()
      }
    }

    connectionState.value = 'connecting'
    messageHandler.value = onMessage
    currentUrl.value = url

    try {
      ws.value = new WebSocket(url)
    } catch (error) {
      console.error('[WebSocket] 创建连接失败:', error)
      scheduleReconnect()
      return
    }

    ws.value.onopen = () => {
      console.log('[WebSocket] 连接成功')
      isConnected.value = true
      connectionState.value = 'connected'
      reconnectAttempts.value = 0 // 重置重连计数

      // 启动心跳
      startHeartbeat()

      // 业务调整：不再自动发送离线队列消息，由业务层决定重发时机或由用户操作
      // flushOfflineQueue()
    }

    ws.value.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        // 收到消息（无论是 pong 还是业务数据），都重置心跳超时
        handleHeartbeatResponse()

        if (message.type === 'pong') {
          return
        }

        if (messageHandler.value) {
          messageHandler.value(message)
        }
      } catch (error) {
        console.error('[WebSocket] 解析消息失败:', error)
      }
    }

    ws.value.onerror = (error) => {
      console.error('[WebSocket] 连接错误:', error)
      isConnected.value = false
      connectionState.value = 'disconnected'
    }

    ws.value.onclose = (event) => {
      console.log('[WebSocket] 连接关闭', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      })

      isConnected.value = false
      stopHeartbeat()

      // 非正常关闭且允许重连，则自动重连
      if (!event.wasClean && shouldReconnect.value) {
        console.log('[WebSocket] 检测到异常断开，准备重连')
        scheduleReconnect()
      } else {
        connectionState.value = 'disconnected'
      }
    }
  }

  /**
   * 连接WebSocket服务器
   * @param {string} url - WebSocket URL
   * @param {function} onMessage - 消息处理回调函数
   */
  const connect = (url, onMessage) => {
    shouldReconnect.value = true
    reconnectAttempts.value = 0
    connectInternal(url, onMessage)
  }

  /**
   * 发送消息（支持离线队列）
   * @param {object} data - 要发送的数据
   * @param {boolean} queueIfOffline - 离线时是否加入队列
   */
  const send = (data, queueIfOffline = true) => {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(data))
    } else {
      console.warn('[WebSocket] 连接未建立')

      if (queueIfOffline && connectionState.value === 'reconnecting') {
        offlineQueue.value.push(data)

        // 限制队列大小
        if (offlineQueue.value.length > 100) {
          offlineQueue.value.shift()
        }
      } else {
        console.error('[WebSocket] 消息发送失败，且未加入队列')
      }
    }
  }

  /**
   * 断开连接
   * @param {boolean} preventReconnect - 是否阻止自动重连
   */
  const disconnect = (preventReconnect = true) => {
    if (preventReconnect) {
      shouldReconnect.value = false
    }

    // 清除重连定时器
    if (reconnectTimer.value) {
      clearTimeout(reconnectTimer.value)
      reconnectTimer.value = null
    }

    // 停止心跳
    stopHeartbeat()

    // 关闭连接
    if (ws.value) {
      ws.value.close(1000, 'Client disconnect')
      ws.value = null
    }

    isConnected.value = false
    connectionState.value = 'disconnected'
    offlineQueue.value = []
  }

  /**
   * 手动触发重连
   */
  const reconnect = () => {
    console.log('[WebSocket] 手动触发重连')
    disconnect(false)
    shouldReconnect.value = true
    reconnectAttempts.value = 0

    if (currentUrl.value && messageHandler.value) {
      connectInternal(currentUrl.value, messageHandler.value)
    }
  }

  // 组件卸载时清理
  onUnmounted(() => {
    disconnect(true)
  })

  return {
    // 基础方法
    connect,
    send,
    disconnect,
    reconnect,
    setLongTaskStatus,

    // 状态
    isConnected,
    connectionState,
    reconnectAttempts,
    shouldReconnect,
    offlineQueueSize: () => offlineQueue.value.length,
    clearOfflineQueue: () => { offlineQueue.value = [] }
  }
}
