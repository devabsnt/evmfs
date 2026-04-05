package main

import (
	"os"
	"path/filepath"
)

type Cache struct {
	Dir string
}

func NewCache(dir string) *Cache {
	return &Cache{Dir: dir}
}

func (c *Cache) Get(chainId, contentHash string) ([]byte, error) {
	path := filepath.Join(c.Dir, chainId, contentHash)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return data, nil
}

func (c *Cache) Set(chainId, contentHash string, data []byte) error {
	dir := filepath.Join(c.Dir, chainId)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	tmpFile, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}

	finalPath := filepath.Join(dir, contentHash)
	if err := os.Rename(tmpPath, finalPath); err != nil {
		os.Remove(tmpPath)
		return err
	}

	return nil
}
