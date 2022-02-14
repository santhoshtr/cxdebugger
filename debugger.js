let translation,
    translatedContentHTML = '',
    translatedContentWikitext = '';

function preview() {
    const targetLanguage = $('#translation-to').val()

    const url = `https://${targetLanguage}.wikipedia.org/api/rest_v1/transform/wikitext/to/html`;

    return wikitext().then(() => {
        axios.post(
            url,
            { wikitext: translatedContentWikitext, body_only: true, stash: true }
        ).then((targethtml) => {
            $('#preview').html(targethtml.data)
        });
    });
};

function getWikitext() {
    const url = `https://${translation.targetLanguage}.wikipedia.org/w/api.php?action=query&titles=${translation.targetTitle}&prop=revisions&rvprop=content&redirects=true&origin=*&format=json&formatversion=2&&rvstartid=${translation.targetRevisionId}`;

    return $.get(url).then((response) => {
        return response.query.pages[0].revisions[0].content;
    });
}

function wikitext() {
    if (translation.status === 'published' || translation.targetURL) {
        return getWikitext().then((response) => {
            translatedContentWikitext = response;
            $('#wikitext').text(translatedContentWikitext)
        });
    }
    const targetLanguage =  $('#translation-to').val()
    const url = `https://${targetLanguage}.wikipedia.org/api/rest_v1/transform/html/to/wikitext`;

    return axios.post(url,
        { html: translatedContentHTML, body_only: true, stash: true }
    ).then((translatedContent) => {
        translatedContentWikitext = translatedContent.data;
        $('#wikitext').text(translatedContentWikitext)
    });
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
}

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
            $userSectionInfo.append( $('<div>').html('Timestamp: ' +  sections[key].user.timestamp))
        }

        if (sections[key].mt) {
            if(!sections[key].user){
                translatedContentHTML += sections[key].mt.content;
            }
            $mtSectionRow = $(sections[key].mt.content);
            $mtSectionInfo = $('<details>').append(
                $('<summary>').html('Section id: ' + key),
            )
            $mtSectionInfo.append( $('<div>').html('Engine: ' +  sections[key].mt.engine));
            $mtSectionInfo.append( $('<div>').html('Timestamp: ' +  sections[key].mt.timestamp))
        }

        $('#cxtable').append(
            $('<tr>').append(
                $('<td>').append($sourceRow),
                $('<td>').append($mtSectionRow, $mtSectionInfo),
                $('<td>').append($sectionRow, $userSectionInfo)
        ));
    }
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
        fetch($('#translation-id').val()).then(onFetch);
        tabs.select('cxtable');
    });

    $('#find').on('click', () => {
        tabs.select('info');
        findTranslation($('#translation-source ').val(), $('#translation-from ').val(), $('#translation-to ').val()).then(onFind)
    });
});