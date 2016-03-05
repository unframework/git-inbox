# git-inbox

## @todo

- simple text uploads
- issue pull request to branch instead of direct push
    - allow multiple successive uploads to same PR

## Development

```sh
npm install

cat <<EOF > env.sh
export TARGET_GIT_URL=https://<user>:<personal-token>@github.com/<user>/<repo>.git

export SLACK_AUTH_TOKEN=<auth-token>
export SLACK_HOOK_TOKEN=<hook-token>
EOF

# repo tests
. env.sh
supervisor index.js

# Slack tests
. env.sh
ngrok http 3010 # then get the URL and add to Slack as outgoing hook in a dedicated channel
supervisor slack.js
```
