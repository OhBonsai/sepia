import { describe, expect, it } from 'vitest'

import { assetPath, assetUrl, isInsideRoot } from '../src/assets/index.ts'

describe('assetUrl / assetPath', () => {
  it('往返：普通路径原样回来', () => {
    const path = '/Users/wp/book/img/2608062236-shot.png'
    expect(assetPath(assetUrl(path))).toBe(path)
  })

  it('往返：空格、中文、`#`、`?` 都得转义——不转会被当 fragment/query 截断', () => {
    const path = '/Users/wp/我的 book/img/图 1 #最终?.png'
    const url = assetUrl(path)
    expect(url).not.toContain(' ')
    expect(url).not.toContain('#')
    expect(url).not.toContain('?')
    expect(assetPath(url)).toBe(path)
  })

  it('分隔符不许一起转义，否则整条路径变成一个文件名', () => {
    expect(assetUrl('/a/b/c.png')).toContain('/a/b/c.png')
  })

  it('别的 scheme 一律 null', () => {
    expect(assetPath('file:///Users/wp/x.png')).toBeNull()
    expect(assetPath('http://localhost/x.png')).toBeNull()
    expect(assetPath('sepia-assetX://local/x.png')).toBeNull()
    expect(assetPath('不是个 url')).toBeNull()
  })

  it('`..` 直接拒——不做"洗干净再放行"', () => {
    expect(assetPath(`${assetUrl('/a/b')}/../../etc/passwd`)).toBeNull()
    expect(assetPath('sepia-asset://local/a/../../etc/passwd')).toBeNull()
  })
})

describe('isInsideRoot', () => {
  it('根自身与根内都算', () => {
    expect(isInsideRoot('/Users/wp/book', '/Users/wp/book')).toBe(true)
    expect(isInsideRoot('/Users/wp/book', '/Users/wp/book/img/x.png')).toBe(true)
    expect(isInsideRoot('/Users/wp/book/', '/Users/wp/book/img/x.png')).toBe(true)
  })

  it('**同前缀的兄弟目录不算**——只比字符串前缀会把 `/book-secret` 放进 `/book`', () => {
    expect(isInsideRoot('/Users/wp/book', '/Users/wp/book-secret/x.png')).toBe(false)
    expect(isInsideRoot('/Users/wp/book', '/Users/wp/other/x.png')).toBe(false)
    expect(isInsideRoot('/Users/wp/book', '/Users/wp')).toBe(false)
  })
})
