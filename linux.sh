container run -it --rm -m 4G -v "$PWD:$PWD" -w "$PWD" node:22 npx . "$@"
