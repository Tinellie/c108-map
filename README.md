

## 创建用户

```sh
cd /opt/c108/deploy/vultr
docker compose exec api node src/tools/create_user.js --username=guest --password='12345678' --role=user
```