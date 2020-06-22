async function parseJsonResponse(response) {
	const data = await response.text();
	const dataWithoutAntiHijackingPrefix = data.substr(data.indexOf('{'));
	return JSON.parse(dataWithoutAntiHijackingPrefix);
}
	
async function getPostId(postUrl) {
	const response = await fetch(postUrl+'?format=json')
	const json = await parseJsonResponse(response);
	return json.payload.value.id;
}

async function getCommentIds(postId) {
	let currentPage, pagingTo;
	const results = [];
	do {
		if (currentPage)
			pagingTo = currentPage.payload.paging.next.to;
		currentPage = await getCommentIdsPage(postId, pagingTo);
		const commentIds = currentPage.payload.streamItems.map(comment => comment.postPreview.postId);
		results.push(...commentIds);
	} while (currentPage.payload.paging.next);
	return results;
}
	
async function getCommentIdsPage(postId, pagingTo) {
	const pagingQueryParam = pagingTo ? '&to='+pagingTo : '';
	const fetchCommentsUrl = 'https://medium.com/_/api/posts/'+postId+'/responsesStream?filter=other'+pagingQueryParam;
	const response = await fetch(fetchCommentsUrl)
	return parseJsonResponse(response);
}

async function getNestedComments(postId) {
	const commentIds = await getCommentIds(postId);
	return Promise.all(commentIds.map(async (commentId) => {
		const comment = await getPostContent(commentId).then(toCommentData);
		const subComments = await getNestedComments(comment.postId);
		comment.childComments = subComments;
		return comment;
	}));
}

async function getPostContent(postId) {
	const response = await fetch('https://medium.com/post/'+postId+'?format=json');
	return parseJsonResponse(response);
}

async function toCommentData(postContent) {
	return {
		postId: postContent.payload.value.id,
		postUrl: postContent.payload.value.canonicalUrl,
		author: postContent.payload.references.User[postContent.payload.value.creatorId].name,
		publicationDate: new Date(postContent.payload.value.firstPublishedAt),
		paragraphs: postContent.payload.value.content.bodyModel.paragraphs.map(para => para.text),
		childComments: []
	};
}

// TODO: add link to publication date vs. author
function renderComment(commentData) {
	const formattedPublicationDate = commentData.publicationDate.toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
	return elem('li', {'style': 'border: dotted; border-width: 1px;'},
		elem('header', {'style': 'font-family: Consolas, monaco, monospace; font-size: 12px'},
			elem('div', {}, elem('strong', {}, commentData.author)),
			elem('time', {}, elem('a', {'href': commentData.postUrl}, formattedPublicationDate)),
		elem('div', {'style': 'font-family: Georgia, serif; font-size: 14px'},
			...commentData.paragraphs.map(para => elem('p', {}, para)))));
}

function renderComments(commentDataList) {	
	return elem('ol', {'style': 'list-style: none'},
		...commentDataList.map(comment => {
			const renderedComment = renderComment(comment);			
			if (comment.childComments.length > 0)
				renderedComment.append(renderComments(comment.childComments));
			return renderedComment;
	}));
}

function elem(tagName, attributes = {}, ...children) {
	const result = document.createElement(tagName, attributes);
	for (const name in attributes)
		result.setAttribute(name, attributes[name]);
	result.append(...children);
	return result;
}

function commentsHeadingFor(postDocument) {
	return elem('h1', {},
		'Comments for: ',
		elem('a', {'href': postDocument.location}, postDocument.title));
}
	
async function renderCommentTreeInNewTab() {
	const postId = await getPostId(document.location);
	const allComments = await getNestedComments(postId);	
	const commentsDocument = window.open().document;
	commentsDocument.body.append(commentsHeadingFor(document));
	commentsDocument.body.append(renderComments(allComments));
}

// TODO:
// - avoid rate-limit errors (status code 429)
// - include markup when rendering comments
// 		- most important "markup" is quote from article, which isn't part of bodyModel.paragraphs; it's in payload.references.Quote (could use Quote.<id>.quoteParagraphPreview.text)
//		- actual markup is in bodyModel.paragraphs[].markups (e.g., hyperlinks)
// - make bookmarklet