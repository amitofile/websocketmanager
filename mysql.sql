-- Adminer 4.8.1 MySQL 5.5.5-10.1.48-MariaDB-0ubuntu0.18.04.1 dump

-- SET NAMES utf8;
SET time_zone = '+05:30';
SET foreign_key_checks = 0;

DROP TABLE IF EXISTS `applications`;
CREATE TABLE `applications` (
  `id` int NOT NULL AUTO_INCREMENT,
  `application` varchar(50) NOT NULL DEFAULT 'default',
  `username` varchar(50) NOT NULL,
  `connections` tinyint NOT NULL DEFAULT '5',
  `scripts` smallint NOT NULL DEFAULT '100',
  `token_validity` mediumint NOT NULL DEFAULT '1440',
  `ips` varchar(255) DEFAULT '["0.0.0.0"]',
  `status` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `name_owner_UNQ` (`application`,`username`) USING BTREE,
  KEY `name_INDX` (`application`) USING BTREE,
  KEY `owner_INDX` (`username`) USING BTREE,
  CONSTRAINT `owner_FK` FOREIGN KEY (`username`) REFERENCES `users` (`username`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `tokens`;
CREATE TABLE `tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tokenid` varchar(50) NOT NULL,
  `username` varchar(50) NOT NULL,
  `application` varchar(50) NOT NULL DEFAULT 'default',
  `jwt` text NOT NULL,
  `validity` mediumint NOT NULL DEFAULT '1440',
  `expiry` varchar(50) DEFAULT NULL,
  `scope` varchar(10) NOT NULL DEFAULT 'normal',
  `metadata` text,
  `metadata2` text,
  `timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `timestamp2` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `status` bigint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `tokenid_UNQ` (`tokenid`),
  UNIQUE KEY `username_application_scope_status` (`username`,`application`,`scope`,`status`),
  KEY `application_INDX` (`application`),
  KEY `tokenid_INDX` (`tokenid`),
  KEY `owner_INDX` (`username`) USING BTREE,
  CONSTRAINT `application_tokens_FK` FOREIGN KEY (`application`) REFERENCES `applications` (`application`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `owner_tokens_FK` FOREIGN KEY (`username`) REFERENCES `users` (`username`) ON DELETE NO ACTION ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL DEFAULT '',
  `clientid` varchar(50) NOT NULL DEFAULT '',
  `clientkey` varchar(128) NOT NULL DEFAULT '',
  `clientsecret` varchar(128) NOT NULL DEFAULT '',
  `metadata` text,
  `timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `timestamp2` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `status` tinyint NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username_UNIQUE` (`username`),
  UNIQUE KEY `clientid_UNIQUE` (`clientid`),
  UNIQUE KEY `clientkey_UNIQUE` (`clientkey`),
  KEY `username_INDX` (`username`),
  KEY `clientid_INDX` (`clientid`),
  KEY `clientkey_INDX` (`clientkey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

SET foreign_key_checks = 1;

-- 2022-11-30 22:32:00