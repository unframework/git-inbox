# git-inbox

## @todo

- text/raw uploads
- CSV uploads
- issue pull request to branch instead of direct push
    - allow multiple successive uploads to same PR
- fix logging
- customizable committer/author
- declarative (target-first) file listener config

## Development

```sh
npm install

cat <<EOF > env.sh
export TARGET_GIT_URL=https://<user>:<personal-token>@github.com/<user>/<repo>.git

export SLACK_AUTH_TOKEN=<auth-token>
EOF

# repo tests
. env.sh
node index.js

# Slack tests
. env.sh
supervisor --extensions 'js,yml' slack.js
```
