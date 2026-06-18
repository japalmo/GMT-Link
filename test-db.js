const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://gmt_admin:gmt_dev_2024@127.0.0.1:5432/gmt_link',
});

client.connect()
  .then(() => {
    console.log('Connected successfully to Postgres from Windows!');
    return client.query('SELECT 1');
  })
  .then((res) => {
    console.log('Query successful:', res.rows);
  })
  .catch((err) => {
    console.error('Connection failed:', err.message);
  })
  .finally(() => {
    client.end();
  });
