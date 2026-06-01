package com.torn.util;

import cn.hutool.db.Db;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.util.List;

public class DBUtil {


    private static final HikariDataSource dataSource;

    static {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://darx.top:14321/golden-eye");
        config.setUsername("readonly");
        config.setPassword("bO6*aF0#aD2%iC0{");

        // 连接池配置
        config.setMaximumPoolSize(10);
        config.setMinimumIdle(5);
        config.setConnectionTimeout(30000);
        config.setIdleTimeout(600000);
        config.setMaxLifetime(1800000);

        dataSource = new HikariDataSource(config);
    }

    /**
     * 获取数据源
     * @return DataSource
     */
    public static DataSource getDataSource() {
        return dataSource;
    }


    /**
     * 根据传入的实体类和 sql 语句，执行数据库查询list
     */
    public static <T> List<T> queryList(Class<T> clazz, String sql) throws SQLException {
        // 执行 sql 并将结果集通过下划线转驼峰转换成实体类,用 hutool
        return Db.use(getDataSource()).query(sql, clazz);
    }



}
