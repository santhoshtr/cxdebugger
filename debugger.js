let translation,
    translatedContentHTML = '',
    translatedContentWikitext = '';

function preview() {
    document.getElementById("progress").style.display="none";

    const targetLanguage = $('#translation-to').val()

    const url = `https://${targetLanguage}.wikipedia.org/api/rest_v1/transform/wikitext/to/html`;

    return wikitext().then(() => {
        axios.post(
            url,
            { wikitext: translatedContentWikitext, body_only: true }
        ).then((targethtml) => {
            $('#preview').html(targethtml.data)
        });
    });
    document.getElementById("progress").style.display="none";
};

function getWikitext() {
    document.getElementById("progress").style.display="none";

    const url = `https://${translation.targetLanguage}.wikipedia.org/w/api.php?action=query&titles=${translation.targetTitle}&prop=revisions&rvprop=content&redirects=true&origin=*&format=json&formatversion=2&&rvstartid=${translation.targetRevisionId}`;

    return $.get(url).then((response) => {
        return response.query.pages[0].revisions[0].content;
    });
    document.getElementById("progress").style.display="none";

}

async function wikitext() {
    document.getElementById("progress").style.display="block";

    translatedContentWikitext=''
    $('#wikitext').text('')
    if (translation.status === 'published' || translation.targetURL) {
        return getWikitext().then((response) => {
            translatedContentWikitext = response;
            $('#wikitext').text(translatedContentWikitext)
        });
    }
    const targetLanguage = $('#translation-to').val()
    const url = `https://${targetLanguage}.wikipedia.org/api/rest_v1/transform/html/to/wikitext`;

    const doc = document.implementation.createHTMLDocument('');
    doc.open();
    doc.write(translatedContentHTML);
    doc.close();
    const cleanedDoc = getCleanedupContent(doc);
    const childSections = cleanedDoc.documentElement.getElementsByTagName('body')[0].children;
    for (let i = 0; i < childSections.length; i++) {
        await axios.post(url,
            { html: childSections[i].outerHTML, body_only: true }
        ).then((translatedContent) => {
            translatedContentWikitext += translatedContent.data;
        }).catch(() => {
            translatedContentWikitext += `\n********Error in section ${i}***********\n`
        });
        $('#wikitext').text(translatedContentWikitext)
    }
    document.getElementById("progress").style.display="none";
};

function fetch(translationId) {
    const url =
        `https://en.wikipedia.org/w/api.php?action=query&list=contenttranslationcorpora&format=json&origin=*&translationid=${translationId}`;
    return $.get(url);
};

function findTranslation(sourcetitle, source, target) {
    const url =
        `https://en.wikipedia.org/w/api.php?action=query&list=contenttranslation&format=json&sourcetitle=${sourcetitle}&from=${source}&to=${target}&origin=*`;

    return $.get(url);
};

function onFind(response) {
    translation = response.query && response.query.contenttranslation.translation;
    if (!translation) {
        alert('Translation not found');
        return;
    }
    translatedContentHTML = '';
    translatedContentWikitext = '';
    fetch(translation.id);
    $('#translation-id').val(translation.id);
    let $table = $('<table>');
    $.each(translation, (key, value) => {
        let $row = $('<tr>');
        $row.append($('<td>').text(key), $('<td>').text(value))
        $table.append($row);
    });
    $('#info').empty().append($table);
    document.getElementById("progress").style.display="none";
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

function onFetch(response) {
    translatedContentHTML = '';
    const sections = response.query.contenttranslationcorpora.sections;
    $('#cxtable').empty().append(
        $('<thead>').append($('<tr>').append(
            $('<td width="33%">').append('Source article'),
            $('<td width="33%">').append('Machine Translation'),
            $('<td width="33%">').append('User Translation'))));

    for (let key in sections) {
        let $sectionRow,
            $mtSectionRow,
            $sourceRow,
            $userSectionInfo,
            $mtSectionInfo;

        if (sections[key].source) {
            $sourceRow = $(sections[key].source.content);
        }

        if (sections[key].user) {
            translatedContentHTML += sections[key].user.content;
            $sectionRow = $(sections[key].user.content);
            $userSectionInfo = $('<details>').append(
                $('<summary>').html('Section id: ' + key),
            )
            $userSectionInfo.append($('<div>').html('Timestamp: ' + sections[key].user.timestamp))
        }

        if (sections[key].mt) {
            if (!sections[key].user) {
                translatedContentHTML += sections[key].mt.content;
            }
            $mtSectionRow = $(sections[key].mt.content);
            $mtSectionInfo = $('<details>').append(
                $('<summary>').html('Section id: ' + key),
            )
            $mtSectionInfo.append($('<div>').html('Engine: ' + sections[key].mt.engine));
            $mtSectionInfo.append($('<div>').html('Timestamp: ' + sections[key].mt.timestamp))
        }

        $('#cxtable').append(
            $('<tr>').append(
                $('<td>').append($sourceRow),
                $('<td>').append($mtSectionRow, $mtSectionInfo),
                $('<td>').append($sectionRow, $userSectionInfo)
            ));
    }
    document.getElementById("progress").style.display="none";
}

function onTabShow(tab) {
    if (tab.id == 'preview') {
        preview();
    }
    if (tab.id == 'wikitext') {
        wikitext();
    }
}

$(document).ready(() => {
    let tabs = M.Tabs.init($('.tabs')[0], {
        onShow: onTabShow
    });

    $('#fetch').on('click', () => {
        document.getElementById("progress").style.display="block";
        fetch($('#translation-id').val()).then(onFetch);
        tabs.select('cxtable');
    });

    $('#find').on('click', () => {
        document.getElementById("progress").style.display="block";
        tabs.select('info');
        findTranslation($('#translation-source ').val(), $('#translation-from ').val(), $('#translation-to ').val()).then(onFind)
    });
});