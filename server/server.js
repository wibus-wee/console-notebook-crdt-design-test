#!/usr/bin/env node

import WebSocket from 'ws'
import http from 'http'
import * as number from 'lib0/number'
import { setupWSConnection } from './utils.js'
import * as decoding from 'lib0/decoding'

const wss = new WebSocket.Server({ noServer: true })
const host = process.env.HOST || '0.0.0.0'
const port = number.parseInt(process.env.PORT || '1234')

const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

wss.on('connection', (ws, request) => {
  setupWSConnection(ws, request)

  // 监听传入的消息
  ws.on('message', /** @param {ArrayBuffer} message */ message => {
    const uint8Array = new Uint8Array(message)
    const decoder = decoding.createDecoder(uint8Array)
    const messageType = decoding.readVarUint(decoder)
    console.log(`Received message type: ${messageType}, length: ${uint8Array.length}`)
    // 可以进一步解析具体内容，但这里先打印类型
  })
})

server.on('upgrade', (request, socket, head) => {
  // You may check auth of request here..
  // Call `wss.HandleUpgrade` *after* you checked whether the client has access
  // (e.g. by checking cookies, or url parameters).
  // See https://github.com/websockets/ws#client-authentication
  wss.handleUpgrade(request, socket, head, /** @param {any} ws */ ws => {
    wss.emit('connection', ws, request)
  })
})

server.listen(port, host, () => {
  console.log(`running at '${host}' on port ${port}`)
})
