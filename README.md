# git-inbox

Slack bot uploads to Git commits/PRs.

## To Do

- Heroku button
- ~~text/raw uploads~~
- CSV uploads
- show diff (if small) in Slack channel as inline attachment
- use Slack reaction to approve pull request
- ~~issue pull request to branch instead of direct push~~
- allow multiple successive uploads to same PR
- ~~cleanup work directory after push~~
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

# Slack tests
. env.sh
supervisor --extensions 'js,yml' slack.js
```
