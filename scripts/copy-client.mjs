// Copy the hand-written client bundle into the build output so the published
// artifact stays self-contained under lib/ (the host resolves it via
// exports["./client"] → ./lib/client/client.js).
import { mkdirSync, copyFileSync } from 'node:fs'

mkdirSync('lib/client', { recursive: true })
copyFileSync('src/client/client.js', 'lib/client/client.js')
console.log('copied src/client/client.js → lib/client/client.js')
