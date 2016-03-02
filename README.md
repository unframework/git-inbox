# git-inbox

## Development

```sh
npm install

cat <<EOF > env.sh
export TARGET_GIT_URL=https://<user>:<personal-token>@github.com/<user>/<repo>.git
EOF

. env.sh
node index.js
```
