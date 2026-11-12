import { describe, expect, it } from 'vitest'
import { detectLanguage, hasTemplateDirective, TEMPLATE_EXTENSIONS } from './classify'

// The ordering rule this slice is built on: the extension supplies the candidate and the
// content decides whether the candidate is right. Every test below checks one side of that
// pair, so a change that admits a dialect on content alone, or on extension alone, fails.

describe('template dialect detection', () => {
  it('admits every template extension on its name', () => {
    expect([...TEMPLATE_EXTENSIONS]).toEqual(['ejs', 'erb', 'hbs', 'mustache', 'twig'])
    for (const ext of TEMPLATE_EXTENSIONS) {
      const detected = detectLanguage(`views/show.${ext}`, '<p>just markup</p>\n')
      expect(detected.language, ext).toBe('template')
      expect(detected.source, ext).toBe('extension')
    }
  })

  it('does not let the HTML body of a template be read as HTML', () => {
    // The regression this exists for: a .ejs file is mostly ordinary markup, so content
    // sniffing labelled it html and the HTML grammar then reported its tags as errors.
    const ejs = detectLanguage(
      'views/index.ejs',
      '<!doctype html>\n<html><body><%= user.name %></body></html>\n',
    )
    expect(ejs.language).toBe('template')
    expect(ejs.source).toBe('extension')
  })

  it('confirms a bare markup extension with the directive marker', () => {
    for (const marker of ['<%', '<%_', '<%-', '<%=', '<%#']) {
      const detected = detectLanguage('pages/home.html', `<p>hi</p>\n${marker} x %>\n`)
      expect(detected.language, marker).toBe('template')
      expect(detected.source, marker).toBe('extension')
    }
  })

  it('leaves markup with no directive as HTML', () => {
    const plain = detectLanguage('public/index.html', '<!doctype html>\n<html><p>hi</p></html>\n')
    expect(plain.language).toBe('html')
    expect(plain.source).toBe('extension')

    // A percent sign in copy is not a directive.
    expect(detectLanguage('deal.html', '<p>Save 50% today</p>\n').language).toBe('html')
  })

  it('never admits a template on content alone', () => {
    // Same body, unrecognised name: the extension offers no candidate, so nothing is rescued.
    const unknown = detectLanguage('notes/scratch.qjx', '<p>hi</p>\n<%= user.name %>\n')
    expect(unknown.language).toBe('unknown')
    expect(unknown.source).toBe('fallback')

    // A text file that quotes the marker stays text; the candidate came from the name.
    expect(detectLanguage('docs/syntax.txt', 'EJS opens a tag with <%= and closes with %>\n').language).toBe(
      'text',
    )
  })

  it('reports the marker by the same rule the detector uses', () => {
    expect(hasTemplateDirective('<%= a %>')).toBe(true)
    expect(hasTemplateDirective('a <%= b')).toBe(true)
    expect(hasTemplateDirective('no directives here')).toBe(false)
    expect(hasTemplateDirective('')).toBe(false)
  })

  it('ignores a marker buried past the head it is allowed to read', () => {
    const padding = 'x'.repeat(70_000)
    expect(hasTemplateDirective(`${padding}<%= hidden %>`)).toBe(false)
    expect(detectLanguage('big.html', `${padding}<%= hidden %>`).language).toBe('html')
  })
})
