
SVG.easing = {
  '-': function (pos) { return pos },
  '<>': function (pos) { return -Math.cos(pos * Math.PI) / 2 + 0.5 },
  '>': function (pos) { return Math.sin(pos * Math.PI / 2) },
  '<': function (pos) { return -Math.cos(pos * Math.PI / 2) + 1 }
}

SVG.Runner = SVG.invent({

  inherit: SVG.EventTarget,
  parent: SVG.Element,

  create: function (options) {

    // ensure a default value
    options = options == null
      ? SVG.defaults.timeline.duration
      : options

    // ensure that we get a controller
    options = typeof options === 'function'
      ? new SVG.Controller(options)
      : options

    // Declare all of the variables
    this._dispatcher = document.createElement('div')
    this._element = null
    this._timeline = null
    this.done = false
    this._queue = []

    // Work out the stepper and the duration
    this._duration = typeof options === 'number' && options
    this._isDeclarative = options instanceof SVG.Controller
    this._stepper = this._isDeclarative ? options : new SVG.Ease()

    // We copy the current values from the timeline because they can change
    this._history = {}

    // Store the state of the runner
    this.enabled = true
    this._time = 0
    this._last = 0
    this.tags = {}

    // Looping variables
    this._haveReversed = false
    this._reversing = false
    this._loopsDone = 0
    this._swing = false
    this._wait = 0
    this._times = 1

    // save the transformation we are starting with
    this._baseTransform = null
  },

  construct: {

    animate: function (duration, delay, when) {
      var o = SVG.Runner.sanitise(duration, delay, when)
      var timeline = this.timeline()
      return new SVG.Runner(o.duration)
        .loop(o)
        .element(this)
        .timeline(timeline)
        .schedule(delay, when)
    },

    delay: function (by, when) {
      return this.animate(0, by, when)
    },
  },

  extend: {

    /*
    Runner Definitions
    ==================
    These methods help us define the runtime behaviour of the Runner or they
    help us make new runners from the current runner
    */

    element: function (element) {
      if(element == null) return this._element
      this._element = element
      return this
    },

    timeline: function (timeline) {
      // check explicitly for undefined so we can set the timeline to null
      if(typeof timeline === 'undefined') return this._timeline
      this._timeline = timeline
      return this
    },

    animate: function(duration, delay, when) {
      var o = SVG.Runner.sanitise(duration, delay, when)
      var runner = new SVG.Runner(o.duration)
      if(this._timeline) runner.timeline(this._timeline)
      if(this._element) runner.element(this._element)
      return runner.loop(o).schedule(delay, when)
    },

    schedule: function (timeline, delay, when) {
      // The user doesn't need to pass a timeline if we already have one
      if(!(timeline instanceof SVG.Timeline)) {
        when = delay
        delay = timeline
        timeline = this.timeline()
      }

      // If there is no timeline, yell at the user...
      if(!timeline) {
        throw Error('Runner cannot be scheduled without timeline')
      }

      // Schedule the runner on the timeline provided
      timeline.schedule(this, delay, when)
      return this
    },

    unschedule: function () {
      var timeline = this.timeline()
      timeline && timeline.unschedule(this)
      return this
    },

    loop: function (times, swing, wait) {
      // Deal with the user passing in an object
      if (typeof times === 'object') {
        swing = times.swing
        wait = times.wait
        times = times.times
      }

      // Sanitise the values and store them
      this._times = times || Infinity
      this._swing = swing || false
      this._wait = wait || 0
      return this
    },

    delay: function (delay) {
      return this.animate(0, delay)
    },

    /*
    Basic Functionality
    ===================
    These methods allow us to attach basic functions to the runner directly
    */

    queue: function (initFn, runFn, alwaysInitialise) {
      this._queue.push({
        alwaysInitialise: alwaysInitialise || false,
        initialiser: initFn || SVG.void,
        runner: runFn || SVG.void,
        initialised: false,
        finished: false,
      })
      var timeline = this.timeline()
      timeline && this.timeline()._continue()
      return this
    },

    during: function (fn) {
      return this.queue(null, fn)
    },

    after (fn) {
      return this.on('finish', fn)
    },

    /*
    Runner animation methods
    ========================
    Control how the animation plays
    */

    time: function (time) {
      if (time == null) {
        return this._time
      }
      let dt = time - this._time
      this.step(dt)
      return this
    },

    duration: function () {
      return this._times * (this._wait + this._duration) - this._wait
    },

    position: function (p) {
      var loopDuration = this._duration + this._wait
      if (p == null) {
        var loopsDone = Math.floor(this._time / loopDuration)
        var relativeTime = (this._time - loopsDone * loopDuration)
        var position = relativeTime / this._duration
        return Math.min(loopsDone + position, this._times)
      }
      var whole = Math.floor(p)
      var partial = p % 1
      var time = loopDuration * whole + this._duration * partial
      return this.time(time)
    },

    absolute: function (p) {
      if (p == null) {
        return Math.min(1, this._time / this.duration())
      }
      return this.time(p * this.duration())
    },

    step: function (dt) {

      // Update the time
      dt = dt == null ? 16 : dt
      this._time += dt

      // If we exceed the duration, just set the time to the duration
      var duration = this.duration()
      this._time = Math.min(duration, this._time)
      // Deal with non-declarative animations directly
      // Explanation: https://www.desmos.com/calculator/wrnybkho4f
      // Figure out how many loops we've done
      var loopDuration = this._duration + this._wait
      var loopsDone = Math.floor(this._time / loopDuration)

      // Figure out if we need to run the animation backwards
      var swinging = this._swing && (loopsDone % 2 === 1)
      var reversing = (swinging && !this._reversing)
        || (!swinging && this._reversing)

      // Figure out the position in the animation
      var endingValue = Number(!this._swing
        || (!this._reversing && this._times % 2 == 1)
        || (this._reversing && this._times % 2 == 0)
      )
      var startingValue = Number(this._reversing)
      var position = (this._time % loopDuration) / this._duration
      var clipPosition = Math.min(1, position)
      var stepperPosition = this._time <= 0 ? startingValue
        : this._time >= duration ? endingValue
        : (reversing ? 1 - clipPosition : clipPosition)

      // Figure out if we need to run the stepper in this frame
      var runNow = this._lastPosition !== stepperPosition && this._time >= 0
      this._lastPosition = stepperPosition

      // Figure out if we just started
      var justStarted = this._lastTime < 0 && this._time > 0
      var justFinished = this._lastTime < this._time && this.time > duration
      this._lastTime = this._time
      if (justStarted) {
        this.fire('start', this)
      }

      // Call initialise and the run function
      this._initialise()
      if ( runNow || this._isDeclarative ) {
        var converged = this._run(this._isDeclarative ? dt : stepperPosition)
        this.fire('step', this)
      }

      // Work out if we are done and return this
      this.done = (converged && this._isDeclarative)
        || (this._time >= duration && !justFinished && !this._isDeclarative)
      if (this.done) {
        this.fire('finish', this)
      }
      return this
    },

    finish: function () {
      return this.step(Infinity)
    },

    reverse: function (reverse) {
      this._reversing = reverse == null ? !this._reversing : reverse
      return this
    },

    ease: function (fn) {
      this._stepper = new SVG.Ease(fn)
      return this
    },

    active: function (enabled) {
      if(enabled == null) return this.enabled
      this.enabled = enabled
      return this
    },

    /*
    Runner Management
    =================
    Functions that are used to help index the runner
    */

    tag: function (name) {
      // Act as a getter to get all of the tags on this object
      if (name == null) return Object.keys(this.tags)

      // Add all of the tags to the object directly
      name = Array.isArray(name) ? name : [name]
      for(var i = name.length; i--;) {
        this.tags[name[i]] = true
      }
      return this
    },

    untag: function (name) {
      name = Array.isArray(name) ? name : [name]
      for(var i = name.length; i--;) {
        delete this.tags[name[i]]
      }
      return this
    },

    getEventTarget: function () {
      return this._dispatcher
    },

    /*
    Private Methods
    ===============
    Methods that shouldn't be used externally
    */

    // Save a morpher to the morpher list so that we can retarget it later
    _rememberMorpher: function (method, morpher) {
      this._history[method] = {
        morpher: morpher,
        caller: this._queue[this._queue.length - 1],
      }
    },

    // Try to set the target for a morpher if the morpher exists, otherwise
    // do nothing and return false
    _tryRetarget: function (method, target) {
      if(this._history[method]) {
        this._history[method].morpher.to(target)
        this._history[method].caller.finished = false
        var timeline = this.timeline()
        timeline && timeline._continue()
        return true
      }
      return false
    },

    // Run each initialise function in the runner if required
    _initialise: function () {
      for (var i = 0, len = this._queue.length; i < len ; ++i) {
        // Get the current initialiser
        var current = this._queue[i]

        // Determine whether we need to initialise
        var needsInit = current.alwaysInitialise || !current.initialised
        var running = !current.finished

        if (needsInit && running) {
          current.initialiser.call(this)
          current.initialised = true
        }
      }
    },

    // Run each run function for the position or dt given
    _run: function (positionOrDt) {

      // Run all of the _queue directly
      var allfinished = true
      for (var i = 0, len = this._queue.length; i < len ; ++i) {

        // Get the current function to run
        var current = this._queue[i]

        // Run the function if its not finished, we keep track of the finished
        // flag for the sake of declarative _queue
        current.finished = current.finished
          || (current.runner.call(this, positionOrDt) === true)
        allfinished = allfinished && current.finished
      }

      // We report when all of the constructors are finished
      return allfinished
    },
  },
})

SVG.Runner.sanitise = function (duration, delay, when) {

  // Initialise the default parameters
  var times = 1
  var swing = false
  var wait = 0
  var duration = duration || SVG.defaults.timeline.duration
  var delay = delay || SVG.defaults.timeline.delay
  var when = when || 'last'

  // If we have an object, unpack the values
  if (typeof duration == 'object' && !(duration instanceof SVG.Stepper)) {
    delay = duration.delay || delay
    when = duration.when || when
    swing = duration.swing || swing
    times = duration.times || times
    wait = duration.wait || wait
    duration = duration.duration || SVG.defaults.timeline.duration
  }

  return {
    duration: duration,
    delay: delay,
    swing: swing,
    times: times,
    wait: wait,
    when: when
  }
}

// Extend the attribute methods separately to avoid cluttering the main
// Timeline class above
SVG.extend(SVG.Runner, {

  attr: function (a, v) {
    return this.styleAttr('attr', a, v)
  },

  // Add animatable styles
  css: function (s, v) {
    return this.styleAttr('css', s, v)
  },

  styleAttr (type, name, val) {
    // apply attributes individually
    if (typeof name === 'object') {
      for (var key in val) {
        this.styleAttr(type, key, val[key])
      }
    }

    var morpher = new SVG.Morphable(this._stepper).to(val)

    this.queue(function () {
      morpher = morpher.from(this.element()[type](name))
    }, function (pos) {
      this.element()[type](name, morpher.at(pos))
      return morpher.done()
    }, this._isDeclarative)

    return this
  },

  zoom: function (level, point) {
   var morpher = new SVG.Morphable(this._stepper).to(new SVG.Number(level))

   this.queue(function() {
     morpher = morpher.from(this.zoom())
   }, function (pos) {
     this.element().zoom(morpher.at(pos), point)
     return morpher.done()
   }, this._isDeclarative)

   return this
 },

  /**
   ** absolute transformations
   **/

  // M v -----|-----(D M v = I v)------|----->  T v
  //
  // 1. define the final state (T) and decompose it (once) t = [tx, ty, the, lam, sy, sx]
  // 2. on every frame: pull the current state of all previous transforms (M - m can change)
  //   and then write this as m = [tx0, ty0, the0, lam0, sy0, sx0]
  // 3. Find the interpolated matrix I(pos) = m + pos * (t - m)
  //   - Note I(0) = M
  //   - Note I(1) = T
  // 4. Now you get the delta matrix as a result: D = I * inv(M)

  transform: function (transforms, relative, affine) {
    affine = transforms.affine || affine || !!transform.a
    relative = transforms.relative || relative || false

    var morpher

    /**
      The default of relative is false
      affine defaults to true if transformations are used and to false when a matrix is given

      We end up with 4 possibilities:
      false, false: absolute direct matrix morph with SVG.Matrix
      true, false: relative direct matrix morph with SVG.Marix or relative whatever was passed transformation with ObjectBag

      false, true: absolute affine transformation with SVG.TransformBag
      true, true: relative whatever was passed transformation with ObjectBag
    **/


    // if we have a relative transformation and its not a matrix
    // we morph all parameters directly with the ObjectBag
    // the following cases are covered here:
    // - true, false with ObjectBag
    // - true, true with ObjectBag
    if(relative && transforms.a == null) {
      morpher = SVG.Morphable.ObjectBag(formatTransforms({}))
        .to(formatTransforms(transforms))
        .stepper(this._stepper)

      return this.queue(function() {}, function (pos) {
        this.pushRightTransform(new Matrix(morpher.at(pos)))
        return morpher.done()
      }, this._isDeclarative)
    }


    // what is left is affine morphing for SVG.Matrix and absolute transformations with TransformBag
    // also non affine direct and relative morhing with SVG.Matrix
    // the following cases are covered here:
    // - false, true with SVG.Matrix
    // - false, true with SVG.TransformBag
    // - true, false with SVG.Matrix
    // - false, false with SVG.Matrix

    // 1.  define the final state (T) and decompose it (once) t = [tx, ty, the, lam, sy, sx]
    var morpher = (transforms.a && !affine)
      ? new SVG.Matrix().to(transforms)
      : new SVG.Morphable.TransformBag().to(transforms)

    morpher.stepper(this._stepper)

    // create identity Matrix for relative not affine Matrix transformation
    morpher.from()

    this.queue(function() {}, function (pos) {

      // 2. on every frame: pull the current state of all previous transforms (M - m can change)
      var curr = this.currentTransform()
      if(!relative) morpher.from(curr)

      // 3. Find the interpolated matrix I(pos) = m + pos * (t - m)
      //   - Note I(0) = M
      //   - Note I(1) = T
      var matrix = morpher.at(pos)

      if(!relative) {
        // 4. Now you get the delta matrix as a result: D = I * inv(M)
        var delta = matrix.multiply(curr.inverse())
        this.pushLeftTransform(delta)
      } else {
        this.pushRightTransform(matrix)
      }

      return morpher.done()
    }, this._isDeclarative)

    return this
  },

  // Animatable x-axis
  x: function (x, relative) {
    return this._queueNumber('x', x)
  },

  // Animatable y-axis
  y: function (y) {
    return this._queueNumber('y', y)
  },

  dx: function (x) {
    return this._queueNumberDelta('dx', x)
  },

  dy: function (y) {
    return this._queueNumberDelta('dy', y)
  },

  _queueNumberDelta: function (method, to) {
      to = new SVG.Number(to)

      // Try to change the target if we have this method already registerd
      if (this._tryRetargetDelta(method, to)) return this

      // Make a morpher and queue the animation
      var morpher = new SVG.Morphable(this._stepper).to(to)
      this.queue(function () {
        var from = this.element()[method]()
        morpher.from(from)
        morpher.to(from + x)
      }, function (pos) {
        this.element()[method](morpher.at(pos))
        return morpher.done()
      }, this._isDeclarative)

      // Register the morpher so that if it is changed again, we can retarget it
      this._rememberMorpher(method, morpher)
      return this
  },

  _queueObject: function (method, to) {

    // Try to change the target if we have this method already registerd
    if (this._tryRetarget(method, to)) return this

    // Make a morpher and queue the animation
    var morpher = new SVG.Morphable(this._stepper).to(to)
    this.queue(function () {
      morpher.from(this.element()[method]())
    }, function (pos) {
      this.element()[method](morpher.at(pos))
      return morpher.done()
    }, this._isDeclarative)

    // Register the morpher so that if it is changed again, we can retarget it
    this._rememberMorpher(method, morpher)
    return this
  },

  _queueNumber: function (method, value) {
    return this._queueObject(method, new SVG.Number(value))
  },

  // Animatable center x-axis
  cx: function (x) {
    return this._queueNumber('cx', x)
  },

  // Animatable center y-axis
  cy: function (y) {
    return this._queueNumber('cy', y)
  },

  // Add animatable move
  move: function (x, y) {
    return this.x(x).y(y)
  },

  // Add animatable center
  center: function (x, y) {
    return this.cx(x).cy(y)
  },

  // Add animatable size
  size: function (width, height) {
    // animate bbox based size for all other elements
    var box

    if (!width || !height) {
      box = this._element.bbox()
    }

    if (!width) {
      width = box.width / box.height * height
    }

    if (!height) {
      height = box.height / box.width * width
    }

    return this
      .width(width)
      .height(height)
  },

  // Add animatable width
  width: function (width) {
    return this._queueNumber('width', width)
  },

  // Add animatable height
  height: function (height) {
    return this._queueNumber('height', height)
  },

  // Add animatable plot
  plot: function (a, b, c, d) {
    // Lines can be plotted with 4 arguments
    if (arguments.length === 4) {
      return this.plot([a, b, c, d])
    }

    return this._queueObject('plot', new this._element.MorphArray(a))

    /*var morpher = this._element.morphArray().to(a)

    this.queue(function () {
      morpher.from(this._element.array())
    }, function (pos) {
      this._element.plot(morpher.at(pos))
    })

    return this*/
  },

  // Add leading method
  leading: function (value) {
    return this._queueNumber('leading', value)
  },

  // Add animatable viewbox
  viewbox: function (x, y, width, height) {
    return this._queueObject('viewbox', new SVG.Box(x, y, width, height))
  },

  update: function (o) {
    if (typeof o !== 'object') {
      return this.update({
        offset: arguments[0],
        color: arguments[1],
        opacity: arguments[2]
      })
    }

    if (o.opacity != null) this.attr('stop-opacity', o.opacity)
    if (o.color != null) this.attr('stop-color', o.color)
    if (o.offset != null) this.attr('offset', o.offset)


    return this
  }
})