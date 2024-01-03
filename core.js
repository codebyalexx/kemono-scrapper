const puppeteer = require('puppeteer')
const fs = require('fs').promises
const https = require('https')
const legacyFs = require('fs')
const path = require("path")
const config = require('./config.js')

module.exports = class Core {

    // SETUP

    constructor() {
        this.setup().then(() => {})
    }

    async setup() {
        // Environment setup
        this.artists = [];
        this.task = {
            name: 'idle',
            payload: {}
        };

        // Download folder setup
        if (!legacyFs.existsSync(path.join(__dirname, 'downloads')))
            await fs.mkdir(path.join(__dirname, 'downloads'));

        // Browser Init
        this.browser = await puppeteer.launch(
            {headless: process.argv.includes('--debug') ? false : 'new'}
        );
        this.page = await this.browser.newPage();
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36')
        await this.page.setViewport({width: 1600, height: 1024});

        // Cookies management
        try {
            const cookieJson = await fs.readFile('cookies.json');
            const cookies = JSON.parse(cookieJson);
            await this.page.setCookie(...cookies);
        } catch (e) {
            console.error("couldnt load cookies", e);
        }
        setInterval(async() => {
            const cookies = await this.page.cookies();
            const cookieJson = JSON.stringify(cookies, null, 2);
            await fs.writeFile('cookies.json', cookieJson);
        }, 6000);

        // Restore old session
        try {
            await this.loadBump()
        } catch (e) {
            // No old session???
            console.error('no bump or bump error')
        }

        // Launch the machine
        return this.eventLoop()
    }

    // EVENT LOOP

    async eventLoop() {
        const { task } = this

        if (task.name === 'idle') return this.nextTask()

        return this.resumeTask(task)
    }

    async nextTask() {
        const { artists } = this

        if (artists.length === 0) {
            setTimeout(async () => {
                return this.eventLoop()
            }, 1000)
        } else {
            const targetArtist = artists.find((artist) => artist.status === 'waiting')
            if (!targetArtist) return setTimeout(async () => {
                return this.eventLoop()
            }, 1000)

            targetArtist.status = 'get_posts'
            targetArtist.taskProgress = 0
            this.task = {
                name: 'get_posts',
                payload: {
                    artistUrl: targetArtist.url,
                    currentPage: 0,
                    pagePostsLinks: [],
                }
            }

            await this.bump()
            return this.eventLoop()
        }
    }

    async resumeTask() {
        const { task } = this

        if (task.name === 'get_posts') return this.task_getPosts()
        if (task.name === 'get_images') return this.task_getImages()
        if (task.name === 'download_images') return this.task_downloadImages()
        if (task.name === 'verify_images') return this.task_verifyImages()

        return this.eventLoop()
    }

    async task_getPosts() {
        const { task } = this
        let { currentPage, pagePostsLinks, artistUrl } = task.payload

        // Getting target artist
        const targetArtist = this.artists.find((artist) => artist.url === artistUrl)

        // Looping to get all pages
        while (currentPage < (targetArtist.totalPages-1)) {
            // Navigate to page and wait for loading
            if (currentPage > 0) await this.page.goto(`${artistUrl}?o=${currentPage * 50}`);
            if (currentPage === 0) await this.page.goto(artistUrl);
            await this.page.waitForSelector('.post-card');

            // Get all posts on the page
            const newLinks = await this.page.evaluate(() => Array.from(document.querySelectorAll('.post-card a'), element => element.href));
            newLinks.forEach((link) => {
                if (!pagePostsLinks.includes(link))
                    pagePostsLinks.push(link)
            });

            // Next page
            currentPage++;

            // Update artist progress
            targetArtist.taskProgress = Math.floor((currentPage / targetArtist.totalPages) * 100)
        }

        // Updating task
        targetArtist.status = 'get_images'
        targetArtist.taskProgress = 0
        this.task = {
            name: 'get_images',
            payload: {
                artistUrl: targetArtist.url,
                pagePostsLinks,
                allImagesLinks: [],
                doneItems: 0
            }
        }

        await this.bump()
        return this.eventLoop()
    }

    async task_getImages() {
        const { task } = this
        let { pagePostsLinks, allImagesLinks, doneItems, artistUrl } = task.payload

        // Getting target artist
        const targetArtist = this.artists.find((artist) => artist.url === artistUrl)

        // Check doneItems to resume the task
        let itemsToSkip = doneItems;

        // Looping to get all images links
        for await (const post of pagePostsLinks) {
            // Check doneItems to resume the task
            if (itemsToSkip > 0) {
                itemsToSkip--;
            } else {
                const postImages = await processPost(post, this.page);
                allImagesLinks.push(...postImages);
                doneItems++;
            }

            // Update artist progress
            targetArtist.taskProgress = Math.floor((doneItems / targetArtist.totalPosts) * 100)

            // Check if divisible of 10
            if (!(doneItems % 10))
                await this.bump()
        }

        // Updating task
        targetArtist.status = 'download_images'
        targetArtist.taskProgress = 0
        targetArtist.totalImages = allImagesLinks.length
        this.task = {
            name: 'download_images',
            payload: {
                artistUrl: targetArtist.url,
                allImagesLinks,
                finishedDownload: 0,
                failedDownloads: []
            }
        }

        await this.bump()
        return this.eventLoop()
    }

    async task_downloadImages() {
        const { task } = this
        let { artistUrl, allImagesLinks, finishedDownload, failedDownloads } = task.payload

        // Getting target artist
        const targetArtist = this.artists.find((artist) => artist.url === artistUrl)

        // Check doneItems to resume the task
        let itemsToSkip = finishedDownload;

        for await (const imageLink of allImagesLinks) {
            // Check doneItems to resume the task
            if (itemsToSkip > 0) {
                itemsToSkip--;
            } else {
                try {
                    await processDownload(imageLink, targetArtist.name);
                } catch (err) {
                    console.error('Error on download ', imageLink, ': ', err);
                    failedDownloads.push(imageLink);
                }
                finishedDownload++;
                await this.bump()
            }

            // Update artist progress
            targetArtist.taskProgress = Math.floor((finishedDownload / targetArtist.totalImages) * 100)
        }

        // Updating task
        targetArtist.status = 'verify_images'
        targetArtist.taskProgress = 0
        this.task = {
            name: 'verify_images',
            payload: {
                artistUrl: targetArtist.url,
                allImagesLinks,
                failedDownloads,
                doneItems: 0
            }
        }

        await this.bump()
        return this.eventLoop()
    }

    async task_verifyImages() {
        const { task } = this
        let { artistUrl, allImagesLinks, failedDownloads, doneItems } = task.payload

        // Getting target artist
        const targetArtist = this.artists.find((artist) => artist.url === artistUrl)

        // Updating task
        targetArtist.status = 'done'
        targetArtist.taskProgress = 100
        this.task = {
            name: 'idle',
            payload: {}
        }

        await this.bump()
        return this.eventLoop()
    }

    // ARTIST MANAGEMENT

    async addArtist(url) {
        if (this.artists.some(artist => artist.url === url)) return

        this.artists.push({
            name: '?',
            url,
            status: 'unfetched',
            totalPages: 0,
            totalPosts: 0,
            totalImages: 0,
            taskProgress: 0
        })

        // Going to page URL
        const importArtistPage = await this.browser.newPage()
        await importArtistPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36')

        try {
            await importArtistPage.goto(url)
            await importArtistPage.waitForSelector('#paginator-top small')

            // Finding total posts numbers
            const totalPostsTextEl = await importArtistPage.$('#paginator-top small');
            let totalPostsText = (await (await totalPostsTextEl.getProperty('textContent')).jsonValue()).trim();
            totalPostsText = Number.parseInt(totalPostsText.slice(totalPostsText.indexOf('of') + 3, totalPostsText.length));
            const numberOfPages =
                (Math.floor(totalPostsText / 50) === totalPostsText / 50)
                    ? (totalPostsText / 50)
                    : (Math.floor(totalPostsText / 50) + 1);

            // Finding artist name and creating folder
            const artistNameElement = await importArtistPage.$('.user-header__profile span[itemprop="name"]');
            const artistName = (await (await artistNameElement.getProperty('textContent')).jsonValue()).trim();
            if (!legacyFs.existsSync(path.join(__dirname, 'downloads', artistName)))
                await fs.mkdir(path.join(__dirname, 'downloads', artistName));

            // Finding artist profile picture
            const artistPictureElement = await importArtistPage.$('.user-header__avatar img.fancy-image__image');
            const artistPictureLink = (await (await artistPictureElement.getProperty('src')).jsonValue()).trim();

            // Saving infos to artist variable
            const targetArtist = this.artists.find((artist) => artist.url === url)
            targetArtist.name = artistName
            targetArtist.picture = artistPictureLink
            targetArtist.totalPages = numberOfPages
            targetArtist.totalPosts = totalPostsText
            targetArtist.status = 'waiting'

            // Bumping data
            await importArtistPage.close()
            await this.bump()
        } catch (ex) {
            this.artists = this.artists.filter((artist) => artist.url !== url)
            console.log('aborted add user ', url, '\n\n', ex)
        }
    }

    async deleteArtist(name) {

    }

    get artistsStatus() {
        return this.artists;
    }

    // BUMP MANAGEMENT

    async bump() {
        const bumpObject = {
            artists: this.artists,
            task: this.task
        }
        const bumpJson = JSON.stringify(bumpObject)
        await fs.writeFile('bump.json', bumpJson)
    }

    async loadBump() {
        const bumpBuffer = await fs.readFile('bump.json')
        const bumpObject = JSON.parse(bumpBuffer)

        this.artists = bumpObject.artists || []
        this.task = bumpObject.task || {
            name: 'idle',
            payload: {}
        }
    }
}

async function processPost(postLink, page) {
    return new Promise(async (resolve, reject) => {
        // Setup page
        await page.goto(postLink);
        try {
            await page.waitForSelector('.post__files');
        } catch (err) {
            resolve([]);
        }

        // Get all images
        const postImagesLinks = await page.evaluate(() => Array.from(document.querySelectorAll('.post__files .fileThumb.image-link'), element => element.href));

        // Return images
        setInterval(() => {
            resolve(postImagesLinks);
        }, config.postAnalystDelay);
    });
}

async function processDownload(downloadLink, artistName) {
    return new Promise(async (resolve, reject) => {
        // Parsing filename from URL
        const downloadLinkWithoutQuery = downloadLink.split(/[?#]/)[0];
        const downloadFilename = downloadLinkWithoutQuery.slice(downloadLinkWithoutQuery.lastIndexOf('/'), downloadLinkWithoutQuery.length);

        // Creating download stream
        const dest = path.join(__dirname, 'downloads', artistName, downloadFilename);
        const file = legacyFs.createWriteStream(dest);
        const request = https.get(downloadLink, async(res) => {
            res.pipe(file);
            file.on('finish', async () => {
                await file.close();
                setInterval(() => {
                    resolve();
                }, config.fileDownloadDelay);
            });
        }).on('error', async (err) => {
            await fs.unlink(dest);
            reject(err);
        });
    });
}
