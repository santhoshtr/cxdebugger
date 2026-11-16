import { getJSON, postForText } from './http.js';

let translation,
    translatedContentHTML = '',
    translatedContentWikitext = '',
    previewInProgress = false,
    wikitextInProgress = false;

function showProgress(visible) {
    document.getElementById('progress').hidden = !visible;
}

function preview() {
    if (previewInProgress) { return }
    previewInProgress = true;
    showProgress(true);

    const targetLanguage = document.getElementById('translation-to').value;

    const url = `https://${targetLanguage}.wikipedia.org/api/rest_v1/transform/wikitext/to/html`;

    return wikitext().then(() => {
        showProgress(true);
        postForText(
            url,
            { wikitext: translatedContentWikitext, body_only: true }
        ).then((targethtml) => {
            document.getElementById('preview').innerHTML = targethtml;
            showProgress(false);
            previewInProgress = false;
        });
    });

};

function getWikitext() {
    showProgress(false);

    const url = `https://${translation.targetLanguage}.wikipedia.org/w/api.php?action=query&titles=${translation.targetTitle}&prop=revisions&rvprop=content&redirects=true&origin=*&format=json&formatversion=2&&rvstartid=${translation.targetRevisionId}`;

    return getJSON(url).then((response) => {
        showProgress(false);
        return response.query.pages[0].revisions[0].content;
    });
}

async function wikitext() {
    if (wikitextInProgress) { return }
    wikitextInProgress = true;
    showProgress(true);

    const wikitextPanel = document.getElementById('wikitext');
    translatedContentWikitext = '';
    wikitextPanel.textContent = '';
    if (translation.status === 'published' || translation.targetURL) {
        return getWikitext().then((response) => {
            translatedContentWikitext = response;
            wikitextPanel.textContent = translatedContentWikitext;
        });
    }
    const targetLanguage = document.getElementById('translation-to').value;
    const url = `https://${targetLanguage}.wikipedia.org/api/rest_v1/transform/html/to/wikitext`;

    const doc = document.implementation.createHTMLDocument('');
    doc.open();
    doc.write(translatedContentHTML);
    doc.close();
    const cleanedDoc = getCleanedupContent(doc);
    const childSections = cleanedDoc.documentElement.getElementsByTagName('body')[0].children;
    for (let i = 0; i < childSections.length; i++) {
        await postForText(url,
            { html: childSections[i].outerHTML, body_only: true }
        ).then((translatedContent) => {
            translatedContentWikitext += translatedContent;
        }).catch(() => {
            translatedContentWikitext += `\n********Error in section ${i}***********\n`
        });
        wikitextPanel.textContent = translatedContentWikitext;
    }
    wikitextInProgress = false;
    showProgress(false);
};

function wikiApi() {
    return document.getElementById('wiki-api').value.replace(/\/+$/, '');
}

function fetchTranslation(translationId) {
    const url =
        `${wikiApi()}/w/api.php?action=query&list=contenttranslationcorpora&format=json&origin=*&translationid=${translationId}`;
    return getJSON(url);
};

function findTranslation(sourcetitle, source, target) {
    const url =
        `${wikiApi()}/w/api.php?action=query&list=contenttranslation&format=json&sourcetitle=${sourcetitle}&from=${source}&to=${target}&origin=*`;

    return getJSON(url);
};

function onFind(response) {
    translation = response.query && response.query.contenttranslation.translation;
    if (!translation) {
        alert('Translation not found');
        return;
    }
    translatedContentHTML = '';
    translatedContentWikitext = '';
    fetchTranslation(translation.id).then(onFetch);
    document.getElementById('translation-id').value = translation.id;
    const table = document.createElement('table');
    for (const [key, value] of Object.entries(translation)) {
        const row = table.insertRow();
        row.insertCell().textContent = key;
        row.insertCell().textContent = value;
    }
    document.getElementById('info').replaceChildren(table);
    showProgress(false);
}

function getCleanedupContent(doc) {
    Array.prototype.forEach.call(doc.body.querySelectorAll('article, section, [data-segmentid]'), function (segment) {
        var parent = segment.parentNode;
        // move all children out of the element
        while (segment.firstChild) {
            parent.insertBefore(segment.firstChild, segment);
        }
        segment.remove();
    });

    // Remove all unadapted links except the ones that are explicitly marked as missing.
    // Refer ve.ui.CXLinkContextItem#createRedLink
    Array.prototype.forEach.call(doc.querySelectorAll('.cx-link'), function (link) {
        var dataCX = JSON.parse(link.getAttribute('data-cx') || '{}');
        if (dataCX.adapted === false && dataCX?.targetTitle?.missing !== true) {
            // Replace the link with its inner content.
            link.replaceWith(link.innerHTML);
        } else {
            ['data-linkid', 'class', 'title', 'id'].forEach(function (attr) {
                link.removeAttribute(attr);
            });
        }
    });

    // Remove empty references. Such references are initially marked as unadapted and CX data
    // is reset upon editing, so we check if reference is still marked as unadapted.
    Array.prototype.forEach.call(doc.querySelectorAll('.mw-ref'), function (element) {
        var dataCX = JSON.parse(element.getAttribute('data-cx') || '{}');

        if (dataCX.adapted === false) {
            element.parentNode.removeChild(element);
        }
    });

    // Remove all pathological transclusions if any. Transclusion without any definition can cause
    // Parsoid errors and hence failing the whole publishing workflow.
    // Example `<span typeof="mw:Transclusion" data-mw="{}" data-cx="[{&quot;adapted&quot;:false}]" id="mwCH0"></span>`
    // These are not necessarily generated by CX adaptation, but resulted form editing workflow.
    Array.prototype.forEach.call(doc.querySelectorAll('[typeof="mw:Transclusion"]'), function (element) {
        var dataMw = JSON.parse(element.getAttribute('data-mw') || '{}');

        if (!dataMw.parts) {
            element.parentNode.removeChild(element);
        }
    });

    // Remove all data-cx attributes. It is irrelevant for publish, reduces the HTML size.
    Array.prototype.forEach.call(doc.querySelectorAll('[data-cx]'), function (element) {
        element.removeAttribute('data-cx');
    });

    // Remove all id attributes from table cells, div tags that are assigned by cxserver.
    Array.prototype.forEach.call(
        doc.querySelectorAll('tr[id], td[id], th[id], table[id], tbody[id], thead[id], div[id]'), function (element) {
            element.removeAttribute('id');
        }
    );

    return doc;
};

function sectionInfo(key, lines) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Section id: ${key}`;
    details.append(summary);
    for (const line of lines) {
        const div = document.createElement('div');
        div.textContent = line;
        details.append(div);
    }
    return details;
}

function onFetch(response) {
    translatedContentHTML = '';
    const sections = response.query.contenttranslationcorpora.sections;
    const table = document.getElementById('cxtable');
    table.innerHTML = '<thead><tr><th>Source article</th><th>Machine Translation</th><th>User Translation</th></tr></thead>';
    const tbody = table.createTBody();

    for (let key in sections) {
        const { source, mt, user } = sections[key];
        const row = tbody.insertRow();
        const sourceCell = row.insertCell();
        const mtCell = row.insertCell();
        const userCell = row.insertCell();

        if (source) {
            sourceCell.innerHTML = source.content;
        }

        if (user) {
            translatedContentHTML += user.content;
            userCell.innerHTML = user.content;
            userCell.append(sectionInfo(key, [`Timestamp: ${user.timestamp}`]));
        }

        if (mt) {
            if (!user) {
                translatedContentHTML += mt.content;
            }
            mtCell.innerHTML = mt.content;
            mtCell.append(sectionInfo(key, [`Engine: ${mt.engine}`, `Timestamp: ${mt.timestamp}`]));
        }
    }
    showProgress(false);
    preview();
}

function onTabShow(id) {
    if (id == 'preview') {
        preview();
    }
    if (id == 'wikitext') {
        wikitext();
    }
}

const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(id) {
    for (const tab of tabs) {
        const panelId = tab.getAttribute('aria-controls');
        const selected = panelId === id;
        tab.setAttribute('aria-selected', selected);
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(panelId).hidden = !selected;
    }
    onTabShow(id);
}

for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab.getAttribute('aria-controls')));
    tab.addEventListener('keydown', (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        if (!step) { return }
        const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
        next.focus();
        selectTab(next.getAttribute('aria-controls'));
    });
}

const findForm = document.getElementById('find-form');

document.getElementById('fetch-form').addEventListener('submit', (event) => {
    event.preventDefault();
    showProgress(true);
    fetchTranslation(document.getElementById('translation-id').value).then(onFetch);
    selectTab('translation');
});

findForm.addEventListener('submit', (event) => {
    event.preventDefault();
    showProgress(true);
    selectTab('info');
    findTranslation(
        document.getElementById('translation-source').value,
        document.getElementById('translation-from').value,
        document.getElementById('translation-to').value
    ).then(onFind);
});

const queryParams = new URLSearchParams(document.location.search);
if( queryParams.has('api')) {
    document.getElementById("wiki-api").value = queryParams.get('api');
}
if( queryParams.has('from')) {
    document.getElementById("translation-from").value = queryParams.get('from');
}
if( queryParams.has('to')) {
    document.getElementById("translation-to").value = queryParams.get('to');
}
if( queryParams.has('page')) {
    document.getElementById("translation-source").value = queryParams.get('page');
}
if( queryParams.has('from') && queryParams.has('to') & queryParams.has('page')) {
    findForm.requestSubmit();
}
