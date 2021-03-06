/**
 * @author oldj
 * @blog https://oldj.net
 *
 * try to apply hosts
 */

'use strict'

const fs = require('fs')
const path = require('path')
const exec = require('child_process').exec
const getPref = require('./actions/getPref')
const getLang = require('./actions/getLang')
const io = require('./io')
const {sys_hosts_path, work_path} = require('./paths')
const crypto = require('crypto')
const md5File = require('md5-file')
const applyAfter_Unix = require('./applyAfter_Unix')
const platform = process.platform
const svr = require('./svr')
const version = require('../version').version.join('.')

let sudo_pswd = ''
let lang = null

function needPswd (str) {
  str = str.toLowerCase()

  console.log('---')
  console.log(str)
  let keys = [
    'Permission denied'
    , 'incorrect password'
    , 'Password:Sorry, try again.'
  ]
  return !!keys.find(k => str.includes(k.toLowerCase()))
}

function apply_Unix (content, callback) {
  let tmp_fn = path.join(work_path, 'tmp.txt')

  if (typeof content !== 'string') {
    callback('bad content')
    return
  }

  io.pWriteFile(tmp_fn, content)
    .then(() => {
      let cmd

      if (!sudo_pswd) {
        cmd = [
          `cat "${tmp_fn}" > ${sys_hosts_path}`
          , `rm -rf ${tmp_fn}`
        ].join(' && ')
      } else {

        sudo_pswd = sudo_pswd
          .replace(/'/g, '\\x27')
          .replace(/\\/g, '\\\\')

        cmd = [
          `echo '${sudo_pswd}' | sudo -S chmod 777 ${sys_hosts_path}`
          , `cat "${tmp_fn}" > ${sys_hosts_path}`
          , `echo '${sudo_pswd}' | sudo -S chmod 644 ${sys_hosts_path}`
          // , 'rm -rf ' + tmp_fn
        ].join(' && ')
      }

      return cmd
    })
    .then(cmd => {
      exec(cmd, function (error, stdout, stderr) {
        // command output is in stdout
        if (!error) {
          callback()
          return
        }

        callback(!sudo_pswd || needPswd(stdout + stderr) ? 'need_sudo' : error)
      })
    })
}

function apply_Win32 (content, callback) {
  // todo 判断写入权限

  try {
    fs.writeFileSync(sys_hosts_path, content, 'utf-8')
  } catch (e) {
    console.log(e)
    let msg = e.message
    msg = `${msg}\n\n${lang.please_run_as_admin}`
    console.log(msg)
    svr.broadcast('alert', msg)
    return
  }

  // todo 刷新 DNS 缓存

  callback()
}

function tryToApply (content, callback) {
  if (platform !== 'win32') {
    // unix
    apply_Unix(content, (e) => {
      if (e) {
        callback(e)
      } else {
        applyAfter_Unix(sudo_pswd, callback)
      }
    })
  } else {
    // win32
    apply_Win32(content, callback)
  }
}

function wrapContent(cnt) {
  return `# SwitchHosts! v${version}

${cnt}`
}

module.exports = (cnt, pswd) => {
  if (pswd) {
    sudo_pswd = pswd
  }
  let pref

  cnt = wrapContent(cnt)

  return Promise.resolve()
    .then(() => {
      return getPref()
        .then(p => {
          pref = p
          return p.user_language || 'en'
        })
        .then(l => {
          return getLang(svr, l)
        })
        .then(v => lang = v || {})
    })
    .then(() => {
      return new Promise((resolve, reject) => {
        let file_md5 = md5File.sync(sys_hosts_path)
        let cnt_md5 = crypto.createHash('md5').update(cnt).digest('hex')

        if (file_md5 === cnt_md5) {
          // 文件相同
          resolve()
          return
        }

        tryToApply(cnt, e => e ? reject(e) : resolve())
        //reject('need_sudo')
      })
    })
    .then(() => {
      return new Promise((resolve, reject) => {
        let after_cmd = pref.after_cmd

        if (after_cmd) {
          exec(after_cmd, (error, stdout, stderr) => {
            // command output is in stdout
            if (error) {
              reject(`AfterCmdError:\n\n${stderr}`)
            } else {
              resolve()
            }
          })

        } else {
          resolve()
        }
      })
    })
}
