const prettyBytes = require('pretty-bytes')
const prettyTime = require('pretty-ms')
const Progress = require('progress')
const nanoprocess = require('./')

const template = [
  '> :name (:pid)',
  'up for :uptime',
  'CPU: :cpu%',
  'MEM: :mem',
  ':pidsCount child process(es)'
].join(' | ')

const sleep = nanoprocess('node', [
  '-e',
  'process.title = "sleep";' +
  'require("cross-spawn")("sleep", [2]);' +
  'Array(10e7).fill(crypto.randomBytes(1024));'
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
      console.log(stats);
      bar.update(0, {
        pidsCount: stats.pids.length,
        uptime: prettyTime(stats.uptime),
        name: stats.name,
        mem: prettyBytes(stats.memory),
        cpu: Math.floor(stats.cpu),
        pid: stats.pid,
      })
    }

    if (stats && stats.uptime > 2000 && 0 === stats.cpu) {
      bar.update(1, stats)
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
