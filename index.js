const express    = require('express');
const Webtask    = require('webtask-tools');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const request = require('request-promise-native');
const contentfulManagement = require('contentful-management');

const app = express();

function apiRequestJson(method, body, token) {
  const options = {
    method: 'POST',
    uri: `https://api.telegram.org/bot${token}/${method}`,
    body,
    json: true
  };

  return request(options).catch((e) => {
    const error = new Error('unable to contact the Telegram bot api');
    error.apiRequestJson = true;
    throw error;
  });
}

function normaliseUrl(url) {
  var normalisedUrl = url;
  
  // replace for medium
  normalisedUrl = normalisedUrl.replace(/\?source=userActivityShare\-([a-zA-Z0-9\-_]+)/, '');
  
  return normalisedUrl;
}

function addToStudyLog(message, contentfulMClient) {
  const url = normaliseUrl(message.trim());

  return contentfulMClient
    .getSpace('iplvzv1tkshg')
    .then((space) => (
      space
        .getEntries({
          content_type: 'studylog',
          'fields.url': url
        })
        .then((entries) => {
          if (entries.items.length) {
            return { alreadyExists: true };
          }
          
          return space
            .createEntry('studylog', {
              fields: {
                url: {
                  'en-GB': url
                }
              }
            })
            .then(entry => entry.publish())
            .then(() => ({ alreadyExists: false }));
        })
    ));
}

function markInStudyLog(message, contentfulMClient) {
  const url = normaliseUrl(message.trim());

  return contentfulMClient
    .getSpace('iplvzv1tkshg')
    .then((space) => (
      space
        .getEntries({
          content_type: 'studylog',
          'fields.url': url
        })
        .then((entries) => {
          if (entries.items[0]) {
            return entries.items[0];
          }
          
          return space
            .createEntry('studylog', {
              fields: {
                url: {
                  'en-GB': url
                }
              }
            })
            .then(entry => entry.publish());
        })
        .then((entry) => {
          entry.fields.studied = {
            'en-GB': true
          };
          return entry.update();
        })
        .then(entry => entry.publish())
    ))
  ;
}

function addToStudyLogRoute(token, chatId, received, contentfulMClient, req, res) {
  return Promise.resolve()
    .then(() => apiRequestJson('sendMessage', {
      chat_id: chatId,
      text: 'Working on it 😎'
    }, token))
    .then(() => addToStudyLog(received, contentfulMClient))
    .then((entry) => {
      if (entry.alreadyExists) {
        return apiRequestJson('sendMessage', {
          chat_id: chatId,
          text: '👀  Already exists'
        }, token);
      }
      
      return apiRequestJson('sendMessage', {
          chat_id: chatId,
          text: '✨  Added to your studylog!'
        }, token);
    })
  ;
}

function markInStudyLogRoute(token, chatId, received, contentfulMClient, req, res) {
  return Promise.resolve()
    .then(() => apiRequestJson('sendMessage', {
      chat_id: chatId,
      text: 'Working on it 😎'
    }, token))
    .then(() => markInStudyLog(received, contentfulMClient))
    .then((entry) => {
      return apiRequestJson('sendMessage', {
          chat_id: chatId,
          text: '✨  Marked as studied in your studylog!'
        }, token);
    })
  ;
}

app.use(morgan('tiny'));
app.use(bodyParser.json());

app.get('/', function (req, res) {
  res.send(`pingpong`);
});

app.post('/:token', function (req, res) {
  const authorisedUser = req.webtaskContext.secrets.AUTHORISED_USER;
  const markInStudyLogToken = req.webtaskContext.secrets.MARK_IN_STUDYLOG_TOKEN;
  const addToStudyLogToken = req.webtaskContext.secrets.ADD_TO_STUDYLOG_TOKEN;
  const routeTokens = [markInStudyLogToken, addToStudyLogToken];
  
  
  const token = req.params.token;
  const received = req.body.message.text;
  const chatId = req.body.message.chat.id;
  const from = req.body.message.from.id;
  
  const contentfulManagementToken = req.webtaskContext.secrets.CONTENTFUL_MANAGEMENT_TOKEN;
  const contentfulMClient = contentfulManagement.createClient({
    accessToken: contentfulManagementToken
  });
  
  const runRoute = function runRoute(route) {
    route(token, chatId, received, contentfulMClient, req, res)
    .catch((e) => {
      if (e.apiRequestJson) {
        console.log(e.message);
        return;
      }

      apiRequestJson('sendMessage', {
        chat_id: chatId,
        text: `😢  There has been an error trying to add the new url ${e.message}`
      }, token);
    })
  };
  
  if (routeTokens.indexOf(token) !== -1) {
    // reply to notify that the webhook received the message
    res.sendStatus(200);
    
    if (parseInt(from, 10) !== parseInt(authorisedUser, 10)) {
      console.log(authorisedUser, from);
      apiRequestJson('sendMessage', {
        chat_id: chatId,
        text: 'Sorry, this bot is private 🙅️'
      }, token)
      .catch(e => console.log(e));

      return;
    }
    
    if (received === '/start') {
      apiRequestJson('sendMessage', {
        chat_id: chatId,
        text: 'Hello 👋'
      }, token)
      .catch(e => console.log(e));

      return;
    }
    
    if (addToStudyLogToken === token) {
      runRoute(addToStudyLogRoute);
    }
    
    if (markInStudyLogToken === token) {
      runRoute(markInStudyLogRoute);
    }
    
    return;
  }
  
  console.log('Token is not valid!');
  res.sendStatus(400);
});

module.exports = Webtask.fromExpress(app);
