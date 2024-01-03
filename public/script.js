const cursorShadow = document.querySelector('#cursorShadow');
document.addEventListener('mousemove', (e) => {
    cursorShadow.style = 'background: radial-gradient(600px at ' + e.pageX + 'px ' + e.pageY + 'px, rgba(29, 78, 216, 0.11), transparent 80%);';
});

const artistUrlField = document.querySelector('input');
const artistAddButton = document.querySelector('#add');
artistAddButton.addEventListener('click', (e) => {
    fetch('/artists', {
        method: 'post',
        headers: {
            "Content-Type": 'application/json'
        },
        body: JSON.stringify({
            url: artistUrlField.value
        })
    })
        .then((res) => res.text())
        .then((data) => {
            if (data === 'ok') artistUrlField.value = ''
            if (data === 'ok') return refreshArtists()
            alert('error on artist add code 1')
        })
})

const artistsDiv = document.querySelector('#artists');
let artists = [];

function refreshArtists() {
    if (artists.length === 0) {
        return artistsDiv.innerHTML = `
            <p class="text-sm text-slate-300 text-semibold">No artists in the queue, you can add one by pasting the link in the text box above.</p>
        `;
    }

    const filteredArtists = artists.filter((artist) => { return artist.status !== 'unfetched'});
    if (filteredArtists.length === 0)
        artistsDiv.innerHTML = ``;
    if (filteredArtists.length > 0)
        artistsDiv.innerHTML = `<ul class="">
            ${filteredArtists.map((artist) => {
                
                const formattedStatusText = {
                    waiting: 'Waiting',
                    get_posts: 'Retrieving Posts',
                    get_images: 'Retrieving Images',
                    download_images: 'Downloading Images',
                    verify_images: 'Verifying',
                    done: 'Done'
                }[artist.status]
            
                const statusColor = {
                    waiting: 'bg-emerald-600 text-slate-300',
                    get_posts: 'bg-indigo-600 text-slate-300',
                    get_images: 'bg-pink-600 text-slate-300',
                    download_images: 'bg-green-600 text-slate-300',
                    verify_images: 'bg-zinc-50 text-slate-800',
                    done: 'bg-green-500 text-slate-300'
                }[artist.status]
                
                return `<li class="grid grid-cols-8 ${artist.status !== 'done' ? 'grid-rows-2' : ''} gap-3">
                    <img src="${artist.picture}" alt="${artist.name}'s profile picture" class="rounded-lg w-full">
                    <p class="col-span-6 flex items-center justify-start text-slate-300 font-semibold">${artist.name} <span class="ml-1.5 rounded-lg p-1 px-2 text-white text-xs ${statusColor}">${formattedStatusText}</span> <span class="ml-1.5 rounded-lg p-1 px-2 text-white text-xs bg-slate-500">${artist.taskProgress}%</span></p>
                    ${artist.status !== 'done' ? `<div class="w-full bg-gray-200 rounded-full h-1.5 mb-4 dark:bg-gray-700 col-span-8 max-h-3">
                        <div class="bg-blue-600 h-1.5 rounded-full" style="width: ${artist.taskProgress}%"></div>
                    </div>` : ''}
                </li>`
            })}
        </ul>`;

    if (artists.some(artist => artist.status === 'unfetched'))
        artistsDiv.innerHTML += `<p class="text-slate-400 text-xs ${filteredArtists.length > 0 ? 'mt-4' : ''}">⚠️ Some artists might be not displayed because they're still in the importing state.</p>`
}

function getArtists() {
    fetch('http://localhost:3000/artists')
        .then((res) => res.json())
        .then((data) => {
            artists = data
            refreshArtists()
        })
}

setInterval(() => {
    getArtists()
}, 100)
getArtists()