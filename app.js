const express = require('express')
const cors = require('cors')
const bodyParser = require('body-parser')
const expressApp = express()
expressApp.use(cors({
    origin: '*'
}))
expressApp.use(express.static('public'))
expressApp.use(bodyParser.urlencoded({
    extended: true
}))
expressApp.use(express.json())
const expressPort = 3000

const Core = require('./core')
const core = new Core()

expressApp.get('/artists', async (req, res) => {
    res.json(core.artistsStatus)
})

expressApp.post('/artists', async (req, res) => {
    const { url } = req.body
    await core.addArtist(url)
    res.send('ok')
})

expressApp.delete('/artists', async (req, res) => {
    const { name } = req.body
    await core.deleteArtist(name)
    res.send('ok')
})

expressApp.listen(expressPort, async () => {
    require('child_process').exec('start http://localhost:3000/');
})