import { App } from './app'

const app = new App()

document.addEventListener('DOMContentLoaded', () => {
  app.init()

  window.addEventListener('resize', function () {
    app.percentageBar.redraw()
    app.graphDisplayManager.requestResize()
    app.serverRegistry.requestResizeAllGraphs()
  }, false)
}, false)
