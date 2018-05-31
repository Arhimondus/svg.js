
// Must Change ....
SVG.easing = {
  '-': function (pos) { return pos },
  '<>': function (pos) { return -Math.cos(pos * Math.PI) / 2 + 0.5 },
  '>': function (pos) { return Math.sin(pos * Math.PI / 2) },
  '<': function (pos) { return -Math.cos(pos * Math.PI / 2) + 1 }
}

var time = performance || Date

var makeSchedule = function (time) {
  return function (runner) {
    var start = time - runner.time()
    var duration = runner.duration()
    var end = start + duration
    return {start: start, duration: duration, end: end, runner: runner}
  }
}

SVG.Timeline = SVG.invent({
  inherit: SVG.EventTarget,

  // Construct a new timeline on the given element
  create: function (element) {

    // Store a reference to the element to call its parent methods
    this._element = element || null
    this._timeSource = function () {
      return time.now()
    }

    this._dispatcher = document.createElement('div')

    // Store the timing variables
    this._startTime = 0
    this._speed = 1.0

    // Play control variables control how the animation proceeds
    this._reverse = false
    this._persist = 0

    // Keep track of the running animations and their starting parameters
    this._baseTransform = null
    this._nextFrame = null
    this._paused = false
    this._runners = []
    this._time = 0
    this._lastSourceTime = 0
    this._lastStepTime = 0
  },

  extend: {

    getEventTarget () {
      return this._dispatcher
    },

    // FIXME: there is no need anymore to save the element on the timeline
    element (element) {
      if(element == null) return this._element
      this._element = element
    },

    /**
     *
     */

    schedule (runner, delay, when) {

      // TODO: If no runner is provided, get the whole schedule
      // TODO: If a runner is provided with no delay or when, get its
      // starting time and delay
      if(runner == null) {
        return this._runners.map(makeSchedule(this._time)).sort(function (a, b) {
          return (a.start - b.start) ||  (a.duration - b.duration)
        })
      }

      runner.unschedule()
      runner.timeline(this)

      // The start time for the next animation can either be given explicitly,
      // derived from the current timeline time or it can be relative to the
      // last start time to chain animations direclty
      var absoluteStartTime
      delay = delay || 0

      // Work out when to start the animation
      if (when == null || when === 'last' || when === 'after') {
        // Take the last time and increment
        absoluteStartTime = this._startTime + delay

      } else if (when === 'absolute' || when === 'start' ) {
        absoluteStartTime = delay

      } else if (when === 'now') {
        absoluteStartTime = this._time + delay

      } else if ( when === 'relative' ) {
        absoluteStartTime = delay

        // This one feels dirty
        // FIXME: For this to work we need an absolute start time on the runner
        // TODO: If the runner already exists, shift it by the delay, otherwise
        // this is relative to the start time ie: 0

      } else {
        // TODO: Throw error
      }

      runner.time(-absoluteStartTime)
      this._startTime = absoluteStartTime + runner.duration()
      this._runners.push(runner)
      this._continue()
      return this
    },

    // remove the runner from this timeline
    unschedule (runner) {
      var index = this._runners.indexOf(runner)
      if(index > -1) {
        this._runners.splice(index, 1)
      }
      runner.timeline(null)
      return this
    },

    play () {

      // Now make sure we are not paused and continue the animation
      this._paused = false
      return this._continue()
    },

    pause () {
      // Cancel the next animation frame and pause
      this._nextFrame = null
      this._paused = true
      return this
    },

    stop () {
      // Cancel the next animation frame and go to start
      this.seek(-this._time)
      return this.pause()
    },

    finish () {
      this.seek(Infinity)
      return this.pause()
    },

    speed (speed) {
      if(speed == null) return this._speed
      this._speed = speed
      return this
    },

    reverse (yes) {
      var currentSpeed = this.speed()
      if(yes == null) return this.speed(-currentSpeed)

      var positive = Math.abs(currentSpeed)
      return this.speed(yes ? positive : -positive)
    },

    seek (dt) {
      this._time += dt
      return this._continue()
    },

    time (time) {
      if(time == null) return this._time
      this._time = time
      return this
    },

    persist (dtOrForever) {
      if (tdOrForever == null) return this._persist
      this._persist = dtOrForever
      return this
    },

    source (fn) {
      if (fn == null) return this._timeSource
      this._timeSource = fn
      return this
    },

    _step () {

      // If the timeline is paused, just do nothing
      if (this._paused) return

      // Get the time delta from the last time and update the time
      // TODO: Deal with window.blur window.focus to pause animations
      var time = this._timeSource()
      var dtSource = time - this._lastSourceTime
      var dtTime = this._speed * dtSource + (this._time - this._lastStepTime)

      this._lastSourceTime = time

      // Update the time
      this._time += dtTime
      this._lastStepTime = this._time

      this.fire('time', this._time)

      // Run all of the runners directly
      var runnersLeft = false
      for (var i = 0, len = this._runners.length; i < len; i++) {
        // Get and run the current runner and ignore it if its inactive
        var runner = this._runners[i]
        if(!runner.active()) continue

        // If this runner is still going, signal that we need another animation
        // frame, otherwise, remove the completed runner
        var finished = runner.step(dtTime).done
        if (!finished) {
          runnersLeft = true

        } else if(this._persist !== true){

          // runner is finished. And runner might get removed

          // TODO: Figure out end time of runner
          var endTime = runner.duration() - runner.time() + this._time

          if(endTime + this._persist < this._time) {
            // FIXME: which one is better?
            // runner.unschedule()
            // --i
            // --len

            // delete runner and correct index
            this._runners.splice(i--, 1) && --len
            runner.timeline(null)
          }

        }
      }

      // TODO: Collapse transformations in transformationBag into one
      // transformation directly
      //
      // Timeline has
      // timeline.transformationBag

      // Get the next animation frame to keep the simulation going
      if (runnersLeft)
        this._nextFrame = SVG.Animator.frame(this._step.bind(this))
      else this._nextFrame = null
      return this
    },

    // Checks if we are running and continues the animation
    _continue () {
      if (this._paused) return this
      if (!this._nextFrame) this._step()
      return this
    }
  },

  // These methods will be added to all SVG.Element objects
  parent: SVG.Element,
  construct: {
    timeline: function () {
      this._timeline = (this._timeline || new SVG.Timeline(this))
      return this._timeline
    },
  }
})