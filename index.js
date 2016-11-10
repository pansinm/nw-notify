var _           = require('lodash'),
    fs          = require('fs'),
    path        = require('path'),
    async       = require('async'),
    Promise     = require('promise'),
    gui         = window.require('nw.gui')

// One animation at a time
var AnimationQueue = function(options) {
  this.options = options
  this.queue = []
  this.running = false
}

AnimationQueue.prototype.push = function(object) {
  if (this.running) {
    this.queue.push(object)
  }
  else {
    this.running = true
    this.animate(object)
  }
}

AnimationQueue.prototype.animate = function(object) {
  var self = this
  object.func.apply(null, object.args)
  .then(function() {
    if (self.queue.length > 0) {
      // Run next animation
      self.animate.call(self, self.queue.shift())
    }
    else {
      self.running = false
    }
  })
  .catch(function(err) {
    log('nw-notify encountered an error!')
    log('Please submit the error stack and code samples to: https://github.com/cgrossde/nw-notify/issues')
    log(err.stack)
  })
}

AnimationQueue.prototype.clear = function() {
  this.queue = []
}

var config = {
  width: 300,
  height: 65,
  padding: 10,
  borderRadius: 5,
  displayTime: 5000,
  animationSteps: 5,
  animationStepMs: 5,
  animateInParallel: true,
  appIcon: null,
  pathToModule: '',
  autoCleanup: true, // Auto cleanup
  logging: true,
  defaultStyleContainer: {
    backgroundColor: '#f0f0f0',
    overflow: 'hidden',
    padding: 8,
    border: '1px solid #CCC',
    fontFamily: 'Arial',
    fontSize: 12,
    position: 'relative',
    lineHeight: '15px'
  },
  defaultStyleAppIcon: {
    overflow: 'hidden',
    float: 'left',
    height: 40,
    width: 40,
    marginRight: 10,
  },
  defaultStyleImage: {
    overflow: 'hidden',
    float: 'right',
    height: 40,
    width: 40,
    marginLeft: 10,
  },
  defaultStyleClose: {
    position: 'absolute',
    top: 1,
    right: 3,
    fontSize: 11,
    color: '#CCC'
  },
  defaultStyleText: {
    margin: 0,
    overflow: 'hidden',
    cursor: 'default'
  },
  defaultWindow: {
    'always_on_top': true,
    'visible_on_all_workspaces': true,
    resizable: false,
    show: false,
    frame: false,
    transparent: true
  },
  htmlTemplate: '<html>\n'
  + '<head></head>\n'
  + '<body style="margin: 0; overflow: hidden; -webkit-user-select: none;">\n'
  + '<div id="container">\n'
  + ' <img src="" id="appIcon" />\n'
  + ' <img src="" id="image" />\n'
  + ' <div id="text">\n'
  + '   <b id="title"></b>\n'
  + '   <p id="message"></p>\n'
  + ' </div>\n'
  + ' <div id="close">X</div>\n'
  + '</div>\n'
  + '</body>\n'
  + '</html>'
}

function setConfig(customConfig) {
  config = _.defaults(customConfig, config)
  calcDimensions()
}

// Little helper functions
function updateAppPath() {
  config.appPath = process.cwd() + '/';
  return config.appPath
}

function getAppPath() {
  if (config.appPath === undefined) {
    return updateAppPath()
  }
  return config.appPath
}

function updateTemplatePath() {
  var scriptPath = path.join(__dirname, 'notification.html')
  // Tricky stuff, sometimes this doesn't work,
  // especially when webpack is involved.
  // Check if we have a file at that location
  try {
    fs.statSync(scriptPath).isFile()
  }
  // No file => create our own temporary notification.html
  catch (err) {
    log('nw-notify: Could not find template ("' + scriptPath + '"). Fallback to writing my own template file.')
    log('nw-notify: To use a different template you need to correct the config.templatePath or simply adapt config.htmlTemplate')
    // Fallback to config.htmlTemplate: Place text
    // in file within working path and use that
    scriptPath = path.join(path.resolve(path.dirname()), 'notification.html')
    try {
      fs.writeFileSync(scriptPath, config.htmlTemplate)
    }
    // Failed to write file
    catch (e) {
      log('nw-notify: Failed writing my own file. nw-notify will not work.', e, e.stack)
    }
  }
  config.templatePath = 'file://' + scriptPath
  return config.templatePath
}

function getTemplatePath() {
  if (config.templatePath === undefined) {
    return updateTemplatePath()
  }
  return config.templatePath
}

function setTemplatePath(path) {
  config.templatePath = path
}

var nextInsertPos = {}
function calcDimensions() {
  // Calc totalHeight & totalWidth
  config.totalHeight = config.height + config.padding
  config.totalWidth = config.width + config.padding

  // Calc pos of first notification:
  config.firstPos = {
    x: config.lowerRightCorner.x - config.totalWidth,
    y: config.lowerRightCorner.y - config.totalHeight
  }

  // Set nextInsertPos
  nextInsertPos.x = config.firstPos.x
  nextInsertPos.y = config.firstPos.y
}

// Init screen to gather some information
gui.Screen.Init()
var screens = gui.Screen.screens

// Use first screen only
var cur_screen = screens[0]

// detect primary screen if more than 1 screen
if (screens.length > 0) {
   for (var i=0; j=screens.length,i<j; i++){
      if (screens[i].bounds.x === 0 && screens[i].bounds.y === 0) {
          cur_screen = screens[i]
      }
   }
}


// Display notifications starting from lower right corner
// Calc lower right corner
config.lowerRightCorner = {}
config.lowerRightCorner.x = cur_screen.bounds.x + cur_screen.work_area.x + cur_screen.work_area.width
config.lowerRightCorner.y = cur_screen.bounds.y + cur_screen.work_area.y + cur_screen.work_area.height

calcDimensions()

// Maximum amount of Notifications we can show:
config.maxVisibleNotifications = Math.floor(cur_screen.work_area.height / (config.totalHeight))
config.maxVisibleNotifications = (config.maxVisibleNotifications > 7) ? 7 : config.maxVisibleNotifications

// Array of windows with currently showing notifications
var activeNotifications = []

// Recycle windows
var inactiveWindows = []

// If we cannot show all notifications, queue them
var notificationQueue = []

// To prevent executing mutliple animations at once
var animationQueue = new AnimationQueue()

// Give each notification a unique id
var latestID = 0

function notify(notification) {
  // Is it an object and only one argument?
  if (arguments.length === 1 && typeof notification === 'object') {
    // Use object instead of supplied parameters
    notification.id = latestID
    latestID++
    animationQueue.push({
      func: showNotification,
      args: [ notification ]
    })
    return notification.id
  }
  else {
    // Since 1.0.0 all notification parameters need to be passed
    // as object.
    log('nw-notify: ERROR since version 1.0.0 notify() only accepts a single object with notification parameters. The use of notify(title, text, ...) was deprecated and removed.')
  }
}

function showNotification(notificationObj) {
  return new Promise(function(resolve, reject) {
    // Can we show it?
    if (activeNotifications.length < config.maxVisibleNotifications) {
      // Get inactiveWindow or create new:
      getWindow().then(function(notificationWindow) {
        // Move window to position
        calcInsertPos()
        notificationWindow.moveTo(nextInsertPos.x, nextInsertPos.y)

        // Add to activeNotifications
        activeNotifications.push(notificationWindow)

        // Close notification function
        var closeNotification = function closeNotification(event) {
          if (notificationObj.closed) {
            //console.log('Already closed')
            return new Promise(function(exitEarly) { exitEarly() })
          }
          else {
            notificationObj.closed = true
          }

          if (notificationObj.onCloseFunc) {
            notificationObj.onCloseFunc({
              event: event,
              id: notificationObj.id
            })
          }

          // Remove event listener
          var newContainer = container.cloneNode(true)
          container.parentNode.replaceChild(newContainer, container)
          clearTimeout(closeTimeout)
          var newCloseButton = closeButton.cloneNode(true)
          closeButton.parentNode.replaceChild(newCloseButton, closeButton)
          // Recycle window
          var pos = activeNotifications.indexOf(notificationWindow)
          activeNotifications.splice(pos, 1)
          inactiveWindows.push(notificationWindow)
          // Hide notification
          notificationWindow.hide()

          checkForQueuedNotifications()

          // Move notifications down
          return moveOneDown(pos)
        }

        // Always add to animationQueue to prevent erros (e.g. notification
        // got closed while it was moving will produce an error)
        var closeNotificationSafely = function(reason) {
          if (reason === undefined)
              reason = 'closedByAPI'
          animationQueue.push({
            func: closeNotification,
            args: [ reason ]
          })
        }


        // Display time per notification basis.
        var displayTime = (notificationObj.displayTime ? notificationObj.displayTime : config.displayTime);

        // Set timeout to hide notification
        var closeTimeout = setTimeout(function() {
          closeNotificationSafely('timeout')
        }, displayTime)

        // Close button
        var notiDoc = notificationWindow.window.document
        var closeButton = notiDoc.getElementById('close')
        closeButton.addEventListener('click',function(event) {
          event.stopPropagation()
          closeNotificationSafely('close')
        })

        // URL
        var container = notiDoc.getElementById('container')
        if (notificationObj.url || notificationObj.onClickFunc) {
          container.addEventListener('click', function() {
            if (notificationObj.url) {
              gui.Shell.openExternal(notificationObj.url)
            }
            if (notificationObj.onClickFunc) {
              notificationObj.onClickFunc({
                event: 'click',
                id: notificationObj.id,
                closeNotification: closeNotificationSafely
              })
            }
          })
        }

        // Set contents, ...
        setNotficationContents(notiDoc, notificationObj)

        // Show window
        notificationWindow.show()

        // Trigger onShowFunc if existent
        if (notificationObj.onShowFunc) {
          notificationObj.onShowFunc({
            event: 'show',
            id: notificationObj.id,
            closeNotification: closeNotificationSafely
          })
        }
        resolve(notificationWindow)
      })
    }
    // Add to notificationQueue
    else {
      notificationQueue.push(notificationObj)
      resolve()
    }
  })
}

function setNotficationContents(notiDoc, notificationObj) {

  // sound
  if (notificationObj.sound) {
    // Check if file is accessible
    try {
      // If it's a local file, check it's existence
      // Won't check remote files e.g. http://
      if (notificationObj.sound.match(/^file\:/) !== null
        || notificationObj.sound.match(/^\//) !== null) {
        fs.statSync(notificationObj.sound.replace('file://', '')).isFile()
      }
      var audio = new window.Audio(notificationObj.sound)
      audio.play()
    }
    catch (e) {
      log('nw-notify: ERROR could not find sound file: ' + notificationObj.sound.replace('file://', ''), e, e.stack)
    }
  }

  // Title
  var titleDoc = notiDoc.getElementById('title')
  titleDoc.innerHTML = notificationObj.title || ''
  // message
  var messageDoc = notiDoc.getElementById('message')
  messageDoc.innerHTML = notificationObj.text || ''
  // Image
  var imageDoc = notiDoc.getElementById('image')
  if (notificationObj.image) {
    imageDoc.src = notificationObj.image
  }
  else {
    setStyleOnDomElement({ display: 'none'}, imageDoc)
  }

}

/**
 * Checks for queued notifications and add them
 * to AnimationQueue if possible
 */
function checkForQueuedNotifications() {
  if (notificationQueue.length > 0 &&
    (activeNotifications.length < config.maxVisibleNotifications)) {
    // Add new notification to animationQueue
    animationQueue.push({
      func: showNotification,
      args: [ notificationQueue.shift() ]
    })
  }
}

/**
 * Moves the notifications one position down,
 * starting with notification at startPos
 *
 * @param  {int} startPos
 */
function moveOneDown(startPos) {
  return new Promise(function(resolve, reject) {
    if (startPos >= activeNotifications || startPos === -1) {
      resolve()
      return
    }
    // Build array with index of affected notifications
    var notificationPosArray = []
    for (var i = startPos; i < activeNotifications.length; i++) {
      notificationPosArray.push(i)
    }
    // Start to animate all notifications at once or in parallel
    var asyncFunc = async.map // Best performance
    if (config.animateInParallel === false) {
      asyncFunc = async.mapSeries // Sluggish
    }
    asyncFunc(notificationPosArray, moveNotificationAnimation, function() {
      resolve()
    })
  })
}

function moveNotificationAnimation(i, done) {
  // Get notification to move
  var notification = activeNotifications[i]
  // Calc new y position
  var newY = config.lowerRightCorner.y - config.totalHeight * (i + 1)
  // Get startPos, calc step size and start animationInterval
  var startY = notification.y
  var step = (newY-startY)/config.animationSteps
  var curStep = 1
  var animationInterval = setInterval(function() {
    // Abort condition
    if (curStep === config.animationSteps) {
      notification.moveTo(config.firstPos.x, newY)
      clearInterval(animationInterval)
      return done(null, 'done')
    }
    // Move one step down
    var y = parseInt(startY + curStep * step);
    notification.moveTo(config.firstPos.x, y)
    curStep++
  }, config.animationStepMs)
}

/**
 * Find next possible insert position (on top)
 */
function calcInsertPos() {
  if (activeNotifications.length < config.maxVisibleNotifications) {
    nextInsertPos.y = config.lowerRightCorner.y - config.totalHeight * (activeNotifications.length + 1)
  }
}

/**
 * Get a window to display a notification. Use inactiveWindows or
 * create a new window
 * @return {Window}
 */
function getWindow() {
  return new Promise(function(resolve, reject) {
    var notificationWindow
    // Are there still inactiveWindows?
    if (inactiveWindows.length > 0) {
      notificationWindow = inactiveWindows.pop()
      resolve(notificationWindow)
    }
    // Or create a new window
    else {
      var windowProperties = config.defaultWindow
      windowProperties.width = config.width
      windowProperties.height = config.height
      gui.Window.open(getTemplatePath(), config.defaultWindow, function (newWindow) {
        // https://github.com/nwjs/nw.js/issues/4898
        newWindow.setShowInTaskbar(false)
        notificationWindow = newWindow;
        // Return once DOM is loaded
        notificationWindow.on('loaded', function () {
          // Style it
          var notiDoc = notificationWindow.window.document
          var container = notiDoc.getElementById('container')
          var appIcon = notiDoc.getElementById('appIcon')
          var image = notiDoc.getElementById('image')
          var close = notiDoc.getElementById('close')
          var message = notiDoc.getElementById('message')
          // Default style
          setStyleOnDomElement(config.defaultStyleContainer, container)
          // Size and radius
          var style = {
            height: config.height - 2 * config.borderRadius - 2 * config.defaultStyleContainer.padding,
            width: config.width - 2 * config.borderRadius - 2 * config.defaultStyleContainer.padding,
            borderRadius: config.borderRadius + 'px'
          }
          setStyleOnDomElement(style, container)
          // Style appIcon or hide
          if (config.appIcon) {
            setStyleOnDomElement(config.defaultStyleAppIcon, appIcon)
            appIcon.src = config.appIcon
          }
          else {
            setStyleOnDomElement({
              display: 'none'
            }, appIcon)
          }
          // Style image
          setStyleOnDomElement(config.defaultStyleImage, image)
          // Style close button
          setStyleOnDomElement(config.defaultStyleClose, close)
          // Remove margin from text p
          setStyleOnDomElement(config.defaultStyleText, message)
          // Done
          resolve(notificationWindow)
        })
      })
    }
  })
}

function setStyleOnDomElement(styleObj, domElement){
  try {
    for (var styleAttr in styleObj){
      domElement.style[styleAttr] = styleObj[styleAttr]
    }
  }
  catch (e) {
    throw new Error('nw-notify: Could not set style on domElement', styleObj, domElement)
  }
}

function closeAll() {
  // Clear out animation Queue and close windows
  animationQueue.clear()
  _.forEach(activeNotifications, function(window) {
    window.close()
  })
  _.forEach(inactiveWindows, function(window) {
    window.close()
  })
  // Reset certain vars
  nextInsertPos = {}
  activeNotifications = []
  inactiveWindows = []
}

function log(){
  if (config.logging === true){
      console.log.apply(console, arguments)
  }
}

/**
 * Auto cleanup
 */
gui.Window.get().on('close', function() {
  if (config.autoCleanup) {
    closeAll()
    gui.App.quit()
  }
})

module.exports.notify = notify
module.exports.setConfig = setConfig
module.exports.getAppPath = getAppPath
module.exports.getTemplatePath = getTemplatePath
module.exports.setTemplatePath = setTemplatePath
module.exports.closeAll = closeAll
