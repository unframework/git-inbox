# git-inbox

Slack bot to convert uploads into Git commits/PRs. Also, since Excel is so popular, transform XLSX into YAML for techies.

## Setup

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/unframework/git-inbox)

Deploy this repo to Heroku or any other Node.js host.

Set up environment vars (config vars in Heroku):

- `TARGET_GIT_URL`: Git repo URL for commit access
    - format: `https://<user>:<personal-token>@github.com/<user>/<repo>.git`
    - create personal access token on the [GitHub Personal access tokens page](https://github.com/settings/tokens)
    - if your repo is at `https://github.com/alice/hello-world` and the secret personal access token is `abcd1234`, use: `https://alice:abcd1234@github.com/alice/hello-world.git`
- `SLACK_AUTH_TOKEN`: Slack bot integration token
    - to get the token: configure a new bot on the [Slack bot config page](https://slack.com/apps/manage/A0F7YS25R-bots)
    - the secret token will look something like: `xyz-12345678-ABCDabcd12345678`

Add the description file to your repo root: `.git-inbox.yml`:

```yaml
# file upload and conversion configuration
files:
  # simple file upload examples
  - hello/acme.txt # any file upload named "acme.txt" saved into "hello/acme.txt"

  - in: *foobar*.txt # any text file upload containing "foobar" in the name
    out: beep.txt # saved in "beep.txt"

  # Excel to YAML conversion examples
  - data/boop.yml # any Excel file upload starting with "boop" converted to YAML and saved into "data/boop.yml"

  - in: hi.xlsx # any Excel file named "hi.xlsx"
    out:
      format: yaml # convert to YAML
      path: my/sub/folder/hithere.yaml # save into given repo path

# publish to repo using GitHub pull requests
push:
  type: github-request # open a GitHub pull request
  base: master # use "master" as base branch (default)

# alternative mode: direct commit to branch
# push:
#   type: branch # push to branch
#   branch: development # commit to "development" branch
```

Now, any time you upload something to the Slack channel where the bot lives, it will commit that file and create a pull request to the target repo! 🤖

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
