import { defineConfig } from 'vite'

export default defineConfig({
  // ใช้ ./ เพื่อให้ deploy บน GitHub Pages ได้โดยไม่ต้องแก้ชื่อ repository
  base: './'
})
