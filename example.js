const prettyBytes = require('pretty-bytes')
const prettyTime = require('pretty-ms')
const Progress = require('progress')
const nanoprocess = require('./')

const template = [
  '> :name (:pid)',
  'up for :uptime',
  'CPU: :cpu%',
  'MEM: :mem',
  ':pidsCount child processes'
].join(' | ')

const sleep = nanoprocess('node', [
  '-e',
  [
    'process.title = "sleep-spawn";',
    'require("cross-spawn")("sleep", [2]);',
    'require("cross-spawn")("sleep", [2]);',
    'Array(4*10e6).fill(crypto.randomBytes(1024));',
  ].join('')
])

const bar = new Progress(template, {
  width: 20,
  total: 1
})

sleep.open((err) => {
  console.log('> opened')

  let timer = 0
  sleep.stat(function onstat(err, stats) {
    if (stats) {
      bar.update(stats.uptime > 2000 && 0 === stats.cpu ? 1 : 0, {
        pidsCount: stats.pids.length,
        uptime: prettyTime(stats.uptime),
        name: stats.name,
        mem: prettyBytes(stats.memory),
        cpu: Math.floor(stats.cpu),
        pid: stats.pid,
      })
    }

    if (stats && stats.uptime > 2000 && 0 === stats.cpu) {
      sleep.close()
    } else if (!err) {
      clearTimeout(timer)
      timer = setTimeout(() => sleep.stat(onstat), 100)
    }
  })

  sleep.process.on('close', () => {
    console.log('')
    console.log('> closed')
  })
})
