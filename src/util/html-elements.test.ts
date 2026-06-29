import { describe, it, expect } from 'vitest'
import { isKnownHtmlElement } from './html-elements.js'

describe('isKnownHtmlElement', () => {
  it('recognizes common HTML5 elements', () => {
    for (const name of ['html', 'head', 'body', 'div', 'p', 'a', 'img', 'section', 'figure', 'video', 'template']) {
      expect(isKnownHtmlElement(name)).toBe(true)
    }
  })
  it('rejects unknown element names', () => {
    expect(isKnownHtmlElement('frobnicate')).toBe(false)
    expect(isKnownHtmlElement('blink')).toBe(false)
  })
})
