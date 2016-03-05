# git-inbox

## Development

```sh
npm install

cat <<EOF > env.sh
export TARGET_GIT_URL=https://<user>:<personal-token>@github.com/<user>/<repo>.git
export SLACK_TOKEN=<token>
EOF

# repo tests
. env.sh
supervisor index.js

# Slack tests
. env.sh
ngrok http 3010 # then get the URL and add to Slack as outgoing hook in a dedicated channel
supervisor slack.js
```
