let translation,
    translatedContentHTML = '',
    translatedContentWikitext = '';

function preview() {
    let url;

    url = 'https://TARGET.wikipedia.org/api/rest_v1/transform/wikitext/to/html';
    url = url.replace('TARGET', $('#translation-to ').val());


    return wikitext().then(() => {
        $.post(url, {
            wikitext: translatedContentWikitext
        }).done((response) => {
            $('#preview').html(response)
        });
    });
};

function getWikitext() {
    let url = 'https://TARGET.wikipedia.org/w/api.php?action=query&titles=TITLE&prop=revisions&rvprop=content&redirects=true&origin=*&format=json&formatversion=2&&rvstartid=REVISION';
    url = url.replace('TITLE', translation.targetTitle);
    url = url.replace('TARGET', translation.targetLanguage);
    url = url.replace('REVISION', translation.targetRevisionId);
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

    let url = 'https://TARGET.wikipedia.org/api/rest_v1/transform/html/to/wikitext';
    url = url.replace('TARGET', $('#translation-to ').val());

    return $.post(url, {
        html: translatedContentHTML
    }).done((response) => {
        translatedContentWikitext = response;
        $('#wikitext').text(translatedContentWikitext)
    });
};

function fetch(translationId) {
    let url;
    url =
        'https://test.wikipedia.org/w/api.php?action=query&list=contenttranslationcorpora&format=json&origin=*&translationid=';
    url = url + translationId;
    return $.get(url);
};

function findTranslation(sourcetitle, source, target) {
    let url =
        'https://test.wikipedia.org/w/api.php?action=query&list=contenttranslation&format=json&sourcetitle=SOURCE&from=FROM&to=TO&origin=*';

    url = url.replace('SOURCE', sourcetitle)
        .replace('FROM', source)
        .replace('TO', target);
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
    let key,
        sections,
        translatedContentHTML = '';

    sections = response.query.contenttranslationcorpora.sections;
    $('#cxtable').empty().append(
        $('<thead>').append($('<tr>').append(
            $('<td width="33%">').append('Source article'),
            $('<td width="33%">').append('Machine Translation'),
            $('<td width="33%">').append('User Translation'))));

    for (key in sections) {
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
            translatedContentHTML += sections[key].mt.content;
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